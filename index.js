const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ChannelType, 
    PermissionsBitField,
    AttachmentBuilder
} = require('discord.js');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const QRCode = require('qrcode');

// ==================== CONFIGURAÇÕES DO SEU PROJETO ====================
const TOKEN = 'MTUzNzU2ODUwNzE3MTA0NTUyNw.GdD9GG.JPV8g3UsCkZ5Tn4ZxQmMelii_x0Md4stzRNfrk'; 
const MP_ACCESS_TOKEN = 'APP_USR-7083602225040875-081317-dd8ad3a00eb653e204b9b4cf61a98a08-1399781162';
const CARGO_JOGADOR_ID = '1537574697129091162';
// =====================================================================

// Inicializa a SDK do Mercado Pago
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

client.once('ready', () => {
    console.log(`🤖 Bot Automatizado Online como: ${client.user.tag}`);
});

// 1. Comando de Setup do Painel
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!setup-ticket') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Apenas administradores podem usar este comando.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 INSCRIÇÕES ZONE WARS - AUTOMÁTICO')
            .setDescription(
                'Clique na categoria desejada para abrir seu ticket privado, gerar o **QR Code Pix automático** e garantir sua vaga na partida!\n\n' +
                '💸 **Escolha seu Lobby:**\n' +
                '🟢 **Casual:** R$ 3,99\n' +
                '🟡 **Prata:** R$ 5,99\n' +
                '🔴 **Elite:** R$ 9,99'
            )
            .setColor('#1EC45C')
            .setFooter({ text: 'Pagamento 100% Automático via PIX' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_casual')
                .setLabel('🟢 Casual (R$ 3,99)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('btn_prata')
                .setLabel('🟡 Prata (R$ 5,99)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_elite')
                .setLabel('🔴 Elite (R$ 9,99)')
                .setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});

// 2. Interações com os Botões
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const user = interaction.user;

    // Definição de valores baseada no botão clicado
    let valor = 0;
    let nomeLobby = '';

    if (interaction.customId === 'btn_casual') { valor = 3.99; nomeLobby = 'Casual'; }
    if (interaction.customId === 'btn_prata') { valor = 5.99; nomeLobby = 'Prata'; }
    if (interaction.customId === 'btn_elite') { valor = 9.99; nomeLobby = 'Elite'; }

    // --- ABRIR TICKET E GERAR PIX ---
    if (valor > 0) {
        await interaction.deferReply({ ephemeral: true });

        const channelName = `ticket-${user.username}`;
        const existingChannel = guild.channels.cache.find(c => c.name === channelName.toLowerCase());

        if (existingChannel) {
            return interaction.editReply({ content: `❌ Você já possui um ticket aberto em ${existingChannel}!` });
        }

        // Criar Canal Privado
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel, 
                        PermissionsBitField.Flags.SendMessages, 
                        PermissionsBitField.Flags.AttachFiles
                    ],
                },
            ],
        });

        // Criar Cobrança Pix via Mercado Pago
        try {
            const paymentData = {
                body: {
                    transaction_amount: valor,
                    description: `Inscrição Zone Wars ${nomeLobby} - ${user.username}`,
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

            // Converter QR Code em Imagem
            const buffer = Buffer.from(qrCodeBase64, 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: 'qrcode.png' });

            const embedTicket = new EmbedBuilder()
                .setTitle(`🎟️ Inscrição Lobby ${nomeLobby} - R$ ${valor.toFixed(2)}`)
                .setDescription(
                    `Olá ${user}, faça o pagamento usando o QR Code abaixo ou o Pix Copia e Cola para validar sua vaga!\n\n` +
                    `📲 **PIX COPIA E COLA:**\n\`\`\`${pixCopiaECola}\`\`\`\n` +
                    `⏳ *O sistema atualizará seu cargo e confirmará sua vaga automaticamente assim que o Pix for detectado!*`
                )
                .setImage('attachment://qrcode.png')
                .setColor('#F1C40F');

            const closeButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('fechar_ticket')
                    .setLabel('🔒 Cancelar / Fechar Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ 
                content: `${user}`, 
                embeds: [embedTicket], 
                files: [attachment],
                components: [closeButton] 
            });

            await interaction.editReply({ content: `✅ Ticket criado com sucesso em ${ticketChannel}!` });

            // LOOP DE CHECAGEM DO PAGAMENTO (Verifica a cada 5 segundos por até 10 minutos)
            let checagens = 0;
            const interval = setInterval(async () => {
                checagens++;
                try {
                    const check = await paymentClient.get({ id: paymentId });
                    
                    if (check.status === 'approved') {
                        clearInterval(interval);

                        // 1. Dar o Cargo de Jogador
                        const member = await guild.members.fetch(user.id);
                        if (member && CARGO_JOGADOR_ID) {
                            await member.roles.add(CARGO_JOGADOR_ID).catch(console.error);
                        }

                        // 2. Notificar no canal do ticket
                        const embedSucesso = new EmbedBuilder()
                            .setTitle('✅ PAGAMENTO CONFIRMADO!')
                            .setDescription(
                                `🎉 **Parabéns ${user}!** Seu Pix de **R$ ${valor.toFixed(2)}** foi aprovado com sucesso.\n\n` +
                                `🏷️ **Cargo Atribuído:** <@&${CARGO_JOGADOR_ID}>\n\n` +
                                `📝 **PRÓXIMO PASSO:** Envie neste chat o seu **Epic ID exato** (Nick no Fortnite) para cadastro no Host.`
                            )
                            .setColor('#2ECC71');

                        await ticketChannel.send({ content: `${user}`, embeds: [embedSucesso] });
                    }
                } catch (err) {
                    console.error('Erro na checagem de pagamento:', err);
                }

                // Cancela a checagem após 10 minutos (120 tentativas x 5s)
                if (checagens >= 120) {
                    clearInterval(interval);
                }
            }, 5000);

        } catch (error) {
            console.error('Erro ao gerar PIX:', error);
            await ticketChannel.send('❌ Erro ao gerar a cobrança Pix. Verifique suas credenciais da API.');
        }
    }

    // Botão de Fechar Ticket
    if (interaction.customId === 'fechar_ticket') {
        await interaction.reply('🔒 Este ticket será fechado em 5 segundos...');
        setTimeout(() => {
            interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

client.login(TOKEN);