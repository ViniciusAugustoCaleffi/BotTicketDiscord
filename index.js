const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ChannelType, 
    PermissionsBitField,
    AttachmentBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// ==================== CONFIGURAÇÕES ====================
const TOKEN = process.env.DISCORD_TOKEN || 'SEU_NOVO_TOKEN_AQUI'; 
const MP_ACCESS_TOKEN = process.env.MP_TOKEN || 'SEU_NOVO_MP_ACCESS_TOKEN_AQUI';
const CARGO_JOGADOR_ID = '1537574697129091162';
const VALOR_INCRICAO = 4.00;
const TAMANHO_MAXIMO_LOBBY = 32;
// =======================================================

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Estado global da fila e mensagem do painel
let jogadoresInscritos = []; // Armazena { id: 'userID', tag: 'userTag' }
let painelMessageId = null;
let painelChannelId = null;

// Registrar Slash Commands (/iniciar-partida e /resetar-lobby)
const commands = [
    new SlashCommandBuilder()
        .setName('iniciar-partida')
        .setDescription('Envia a chave e o código do mapa para todos os 32 jogadores inscritos no privado.')
        .addStringOption(option => 
            option.setName('chave')
                .setDescription('Chave personalizada da sala do Fortnite (ex: ZONE32)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('mapa')
                .setDescription('Código do mapa de Zone Wars')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('resetar-lobby')
        .setDescription('Zera a fila manualmente e libera o painel para novas inscrições.')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`🤖 Bot Automatizado Online como: ${client.user.tag}`);
    
    // Registrar comandos / no Discord
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash Commands (/iniciar-partida e /resetar-lobby) registrados!');
    } catch (error) {
        console.error('Erro ao registrar Slash Commands:', error);
    }
});

// Funções Utilitárias para o Painel
function gerarEmbedPainel() {
    const qtd = jogadoresInscritos.length;
    return new EmbedBuilder()
        .setTitle('🏆 ZONE WARS COMPETITIVO - LOBBY R$ 4,00')
        .setDescription(
            `Entre no lobby pago e busque as maiores premiações em Pix!\n\n` +
            `📊 **STATUS DO LOBBY:** \`[ ${qtd} / ${TAMANHO_MAXIMO_LOBBY} ]\` Players Inscritos\n` +
            `💸 **Valor da Inscrição:** R$ ${VALOR_INCRICAO.toFixed(2)}\n\n` +
            `*Assim que o lobby atingir ${TAMANHO_MAXIMO_LOBBY} jogadores, as entradas fecham e a chave será enviada na DM dos confirmados.*`
        )
        .setColor(qtd >= TAMANHO_MAXIMO_LOBBY ? '#E74C3C' : '#2ECC71')
        .setFooter({ text: 'Pagamento 100% Automático via PIX' });
}

function gerarBotaoPainel() {
    const desabilitado = jogadoresInscritos.length >= TAMANHO_MAXIMO_LOBBY;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_entrar_lobby')
            .setLabel(desabilitado ? 'Lobby Lotado (32/32)' : `Entrar no Lobby (R$ ${VALOR_INCRICAO.toFixed(2)})`)
            .setStyle(desabilitado ? ButtonStyle.Danger : ButtonStyle.Success)
            .setDisabled(desabilitado)
    );
}

async function atualizarPainelPrincipal() {
    if (!painelChannelId || !painelMessageId) return;
    try {
        const channel = await client.channels.fetch(painelChannelId);
        const msg = await channel.messages.fetch(painelMessageId);
        await msg.edit({ embeds: [gerarEmbedPainel()], components: [gerarBotaoPainel()] });
    } catch (err) {
        console.error('Erro ao atualizar mensagem do painel:', err);
    }
}

// 1. Comando !setup-zone para criar o painel
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!setup-zone') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Apenas administradores podem usar este comando.');
        }

        const msg = await message.channel.send({
            embeds: [gerarEmbedPainel()],
            components: [gerarBotaoPainel()]
        });

        painelMessageId = msg.id;
        painelChannelId = message.channel.id;
        await message.delete().catch(() => {});
    }
});

// 2. Interações com o Botão de Inscrição
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'btn_entrar_lobby') {
        const user = interaction.user;
        const guild = interaction.guild;

        // Verificar se o usuário já está no lobby
        if (jogadoresInscritos.some(p => p.id === user.id)) {
            return interaction.reply({ content: '❌ Você já está inscrito neste lobby!', ephemeral: true });
        }

        if (jogadoresInscritos.length >= TAMANHO_MAXIMO_LOBBY) {
            return interaction.reply({ content: '❌ Este lobby acabou de lotar! Aguarde a próxima rodada.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const channelName = `ticket-${user.username}`;
        const existingChannel = guild.channels.cache.find(c => c.name === channelName.toLowerCase());
        if (existingChannel) {
            return interaction.editReply({ content: `❌ Você já tem um ticket de pagamento aberto em ${existingChannel}!` });
        }

        // Criar Canal Privado de Pagamento
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        // Criar Cobrança Pix no Mercado Pago
        try {
            const paymentData = {
                body: {
                    transaction_amount: VALOR_INCRICAO,
                    description: `Inscrição Zone Wars - ${user.username}`,
                    payment_method_id: 'pix',
                    payer: {
                        email: `${user.id}@discorduser.com`,
                        first_name: user.username
                    }
                }
            };

            const result = await paymentClient.create(paymentData);
            const pixCopiaECola = result.point_of_interaction.transaction_data.qr_code;
            const qrCodeBase64 = result.point_of_interaction.transaction_data.qr_code_base64;
            const paymentId = result.id;

            const buffer = Buffer.from(qrCodeBase64, 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: 'qrcode.png' });

            const embedTicket = new EmbedBuilder()
                .setTitle(`🎟️ Inscrição Zone Wars - R$ ${VALOR_INCRICAO.toFixed(2)}`)
                .setDescription(
                    `Olá ${user}, pague via QR Code ou Pix Copia e Cola para garantir sua vaga no lobby!\n\n` +
                    `📲 **PIX COPIA E COLA:**\n\`\`\`${pixCopiaECola}\`\`\`\n` +
                    `⏳ *Sua vaga será confirmada e o contador do servidor atualizará assim que o Pix for aprovado!*`
                )
                .setImage('attachment://qrcode.png')
                .setColor('#F1C40F');

            const closeButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('fechar_ticket')
                    .setLabel('🔒 Cancelar Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ 
                content: `${user}`, 
                embeds: [embedTicket], 
                files: [attachment], 
                components: [closeButton] 
            });

            await interaction.editReply({ content: `✅ Ticket de pagamento criado em ${ticketChannel}!` });

            // Loop de verificação do Pix
            let checagens = 0;
            const interval = setInterval(async () => {
                checagens++;
                try {
                    const check = await paymentClient.get({ id: paymentId });

                    if (check.status === 'approved') {
                        clearInterval(interval);

                        // Garante que o usuário não entrou duas vezes no processo
                        if (!jogadoresInscritos.some(p => p.id === user.id)) {
                            jogadoresInscritos.push({ id: user.id, tag: user.tag });
                        }

                        // Atribui Cargo no Discord
                        const member = await guild.members.fetch(user.id).catch(() => null);
                        if (member && CARGO_JOGADOR_ID) {
                            await member.roles.add(CARGO_JOGADOR_ID).catch(console.error);
                        }

                        // Atualiza o contador no painel público
                        await atualizarPainelPrincipal();

                        // Envia confirmação e apaga o ticket em 10 segundos
                        const embedSucesso = new EmbedBuilder()
                            .setTitle('✅ VAGA CONFIRMADA!')
                            .setDescription(
                                `🎉 **Parabéns ${user}!** Seu Pix foi aprovado com sucesso.\n\n` +
                                `📊 Você é o player **[ ${jogadoresInscritos.length} / ${TAMANHO_MAXIMO_LOBBY} ]** do lobby.\n` +
                                `📩 Aguarde as instruções e a Chave da Partida que será enviada no seu privado (DM) quando o lobby lotar.`
                            )
                            .setColor('#2ECC71');

                        await ticketChannel.send({ content: `${user}`, embeds: [embedSucesso] });
                        
                        setTimeout(() => {
                            ticketChannel.delete().catch(() => {});
                        }, 10000);
                    }
                } catch (err) {
                    console.error('Erro ao checar pagamento:', err);
                }

                if (checagens >= 120) clearInterval(interval); // Limite de 10 minutos
            }, 5000);

        } catch (error) {
            console.error('Erro ao gerar Pix:', error);
            await ticketChannel.send('❌ Erro ao gerar o Pix. Tente novamente mais tarde.');
        }
    }

    // Botão Fechar Ticket
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
        await interaction.reply('🔒 Fechando ticket...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    }

    // Comandos de Administrador (Slash Commands)
    if (interaction.isChatInputCommand()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Você não tem permissão para usar este comando.', ephemeral: true });
        }

        // /iniciar-partida
        if (interaction.commandName === 'iniciar-partida') {
            const chave = interaction.options.getString('chave');
            const mapa = interaction.options.getString('mapa');

            if (jogadoresInscritos.length === 0) {
                return interaction.reply({ content: '❌ Não há nenhum jogador na lista do lobby atual.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            let falhas = 0;
            let sucessos = 0;

            const embedDM = new EmbedBuilder()
                .setTitle('🎮 SUA PARTIDA DE ZONE WARS VAI COMECAR!')
                .setDescription(
                    `A chave e o mapa do seu confronto já estão disponíveis:\n\n` +
                    `🔑 **CUSTOM KEY (CHAVE):** \`${chave}\`\n` +
                    `🗺️ **CÓDIGO DO MAPA:** \`${mapa}\`\n\n` +
                    `⚠️ *Entre na sala no Fortnite imediatamente. Boa sorte!*`
                )
                .setColor('#F1C40F');

            for (const player of jogadoresInscritos) {
                try {
                    const discordUser = await client.users.fetch(player.id);
                    await discordUser.send({ embeds: [embedDM] });
                    sucessos++;
                } catch (err) {
                    falhas++;
                    console.error(`Não foi possível enviar DM para ${player.tag}`);
                }
            }

            // Salva a quantidade enviada, limpa o array do lobby e zera o painel público para nova partida
            const totalEnviados = jogadoresInscritos.length;
            jogadoresInscritos = [];
            await atualizarPainelPrincipal();

            await interaction.editReply({
                content: `🚀 **Partida Iniciada!**\n\n` +
                         `✅ Códigos enviados na DM de **${sucessos}** jogadores.\n` +
                         `${falhas > 0 ? `⚠️ **${falhas}** jogadores estão com a DM fechada e não receberam.` : ''}\n` +
                         `🔄 O lobby do painel público foi **zerado para [ 0 / 32 ]** e está pronto para novas inscrições!`
            });
        }

        // /resetar-lobby
        if (interaction.commandName === 'resetar-lobby') {
            jogadoresInscritos = [];
            await atualizarPainelPrincipal();
            await interaction.reply({ content: '🔄 O lobby foi zerado manualmente e o painel foi atualizado para [ 0 / 32 ]!', ephemeral: true });
        }
    }
});

client.login(TOKEN);
