const http = require('http');
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 8080);
require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');


// ─── Keep Alive ────────────────────────────────────────────────────────────
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 8080);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
    ]
});

const startTime = Date.now();

// ─── In-memory stores ──────────────────────────────────────────────────────
const warnings   = new Map(); // userId -> [{ reason, mod, date }]
const modLogs    = [];        // [{ action, target, mod, reason, date }]
const activeTrivia = new Map();

// ─── Football Trivia ───────────────────────────────────────────────────────
const triviaQuestions = [
    { question: "Which country has won the most FIFA World Cups?", answer: "brazil", display: "Brazil" },
    { question: "Who is the all-time top scorer in World Cup history?", answer: "miroslav klose", display: "Miroslav Klose" },
    { question: "Which club has won the most UEFA Champions League titles?", answer: "real madrid", display: "Real Madrid" },
    { question: "Which player has won the most Ballon d'Or awards?", answer: "messi", display: "Lionel Messi" },
    { question: "Which country hosted the first ever FIFA World Cup?", answer: "uruguay", display: "Uruguay" },
    { question: "Who scored the 'Hand of God' goal?", answer: "maradona", display: "Diego Maradona" },
    { question: "Which country won the 2022 FIFA World Cup?", answer: "argentina", display: "Argentina" },
    { question: "Which club did Cristiano Ronaldo start his career at?", answer: "sporting cp", display: "Sporting CP" },
    { question: "Which nation won Euro 2020 (played in 2021)?", answer: "italy", display: "Italy" },
    { question: "Who is known as 'The Special One'?", answer: "jose mourinho", display: "José Mourinho" },
    { question: "Which Premier League club has the most top-flight titles?", answer: "manchester united", display: "Manchester United" },
    { question: "Which African nation reached the semi-finals of the 2022 World Cup?", answer: "morocco", display: "Morocco" },
    { question: "Who won the 2024 UEFA Champions League?", answer: "real madrid", display: "Real Madrid" },
    { question: "What colour card results in a player being sent off?", answer: "red", display: "Red card" },
    { question: "How many players are on the pitch per team in football?", answer: "11", display: "11" }
];

// ─── Football API ──────────────────────────────────────────────────────────
const LEAGUE_IDS   = { pl: 39, laliga: 140, ucl: 2, bundesliga: 78, seriea: 135, ligue1: 61 };
const LEAGUE_NAMES = { pl: 'Premier League', laliga: 'La Liga', ucl: 'Champions League', bundesliga: 'Bundesliga', seriea: 'Serie A', ligue1: 'Ligue 1' };

async function fetchFootball(endpoint) {
    const res = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {
        headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY }
    });
    return res.json();
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function hasMod(member) {
    return member.roles.cache.some(r => r.name === 'Match Officials') || member.permissions.has(PermissionFlagsBits.Administrator);
}

function logAction(action, target, mod, reason = 'No reason provided') {
    modLogs.unshift({ action, target: target?.user?.tag || target, mod: mod?.user?.tag || mod, reason, date: new Date() });
    if (modLogs.length > 200) modLogs.pop();

    // Send to bot-logs channel
    const botLogsChannel = client.channels.cache.find(c => c.name.toLowerCase() === 'bot-logs');
    if (botLogsChannel) {
        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle(`📋 ${action}`)
            .addFields(
                { name: 'Target', value: target?.user?.tag || target, inline: true },
                { name: 'Moderator', value: mod?.user?.tag || mod, inline: true },
                { name: 'Reason', value: reason }
            )
            .setTimestamp();
        botLogsChannel.send({ embeds: [embed] }).catch(() => {});
    }
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

// ─── Slash Commands ────────────────────────────────────────────────────────
const commands = [

    // ── MODERATION ────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
        .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
        .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID')
        .addStringOption(o => o.setName('userid').setDescription('User ID to unban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder().setName('tempban').setDescription('Temporarily ban a member')
        .addUserOption(o => o.setName('user').setDescription('User to tempban').setRequired(true))
        .addIntegerOption(o => o.setName('hours').setDescription('Hours to ban for').setRequired(true).setMinValue(1).setMaxValue(720))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder().setName('mute').setDescription('Timeout (mute) a member')
        .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true))
        .addIntegerOption(o => o.setName('minutes').setDescription('Minutes to mute for').setRequired(true).setMinValue(1).setMaxValue(40320))
        .addStringOption(o => o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a member')
        .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
        .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('warnings').setDescription('Check warnings for a user')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear all warnings for a user')
        .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('purge').setDescription('Delete messages from this channel')
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder().setName('nick').setDescription("Change a member's nickname")
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption(o => o.setName('nickname').setDescription('New nickname (leave blank to reset)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

    new SlashCommandBuilder().setName('roleadd').setDescription('Add a role to a member')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder().setName('roleremove').setDescription('Remove a role from a member')
        .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder().setName('lock').setDescription('Lock a channel so members cannot send messages')
        .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode in a channel')
        .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
        .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed')
        .addStringOption(o => o.setName('message').setDescription('Announcement content').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to announce in (defaults to current)'))
        .addStringOption(o => o.setName('title').setDescription('Embed title'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder().setName('logs').setDescription('View recent moderation logs')
        .addIntegerOption(o => o.setName('amount').setDescription('How many logs to show (default 10, max 25)').setMinValue(1).setMaxValue(25))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    new SlashCommandBuilder().setName('report').setDescription('Report a user to staff')
        .addUserOption(o => o.setName('user').setDescription('User to report').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for report').setRequired(true)),

    // ── INFO ──────────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder().setName('uptime').setDescription('See how long the bot has been online'),
    new SlashCommandBuilder().setName('botinfo').setDescription('Bot statistics and info'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('View server information'),

    new SlashCommandBuilder().setName('userinfo').setDescription('View info about a user')
        .addUserOption(o => o.setName('user').setDescription('User (defaults to yourself)')),

    new SlashCommandBuilder().setName('roles').setDescription('List roles of a user')
        .addUserOption(o => o.setName('user').setDescription('User (defaults to yourself)')),

    new SlashCommandBuilder().setName('avatar').setDescription("Show a user's avatar")
        .addUserOption(o => o.setName('user').setDescription('User (defaults to yourself)')),

    new SlashCommandBuilder().setName('channelinfo').setDescription('View info about a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)')),

    new SlashCommandBuilder().setName('invite').setDescription('Get the bot invite link'),
    new SlashCommandBuilder().setName('randommember').setDescription('Pick a random server member'),
    new SlashCommandBuilder().setName('countroles').setDescription('Show member count per role'),

    new SlashCommandBuilder().setName('vote').setDescription('Create a quick yes/no vote')
        .addStringOption(o => o.setName('question').setDescription('The question').setRequired(true)),

    new SlashCommandBuilder().setName('say').setDescription('Make the bot say something')
        .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to send in'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder().setName('serverbanner').setDescription('Show the server banner'),

    // ── FOOTBALL ──────────────────────────────────────────────────────────
    new SlashCommandBuilder().setName('scores').setDescription('Get live/recent football scores')
        .addStringOption(o => o.setName('league').setDescription('League').setRequired(true)
            .addChoices(
                { name: 'Premier League', value: 'pl' }, { name: 'La Liga', value: 'laliga' },
                { name: 'Champions League', value: 'ucl' }, { name: 'Bundesliga', value: 'bundesliga' },
                { name: 'Serie A', value: 'seriea' }, { name: 'Ligue 1', value: 'ligue1' }
            )),

    new SlashCommandBuilder().setName('standings').setDescription('Get league standings')
        .addStringOption(o => o.setName('league').setDescription('League').setRequired(true)
            .addChoices(
                { name: 'Premier League', value: 'pl' }, { name: 'La Liga', value: 'laliga' },
                { name: 'Bundesliga', value: 'bundesliga' }, { name: 'Serie A', value: 'seriea' },
                { name: 'Ligue 1', value: 'ligue1' }
            )),

    new SlashCommandBuilder().setName('player').setDescription("Look up a player's stats")
        .addStringOption(o => o.setName('name').setDescription('Player name').setRequired(true)),

    new SlashCommandBuilder().setName('trivia').setDescription('Start a football trivia question'),

    new SlashCommandBuilder().setName('answer').setDescription('Answer the active trivia question')
        .addStringOption(o => o.setName('answer').setDescription('Your answer').setRequired(true)),

].map(cmd => cmd.toJSON());

// ─── Register Commands ─────────────────────────────────────────────────────
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered!');
    } catch (err) { console.error('Failed to register commands:', err); }
}

// ─── Interaction Handler ───────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, member, channel, guild } = interaction;

    // ══ MODERATION ════════════════════════════════════════════════════════

    if (commandName === 'kick') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        if (!target?.kickable) return interaction.reply({ content: '❌ I cannot kick this user.', ephemeral: true });
        await target.kick(reason);
        logAction('KICK', target, member, reason);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('👢 Member Kicked')
            .addFields({ name: 'User', value: target.user.tag }, { name: 'Reason', value: reason }).setTimestamp()] });
    }

    if (commandName === 'ban') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        if (!target?.bannable) return interaction.reply({ content: '❌ I cannot ban this user.', ephemeral: true });
        await target.ban({ reason });
        logAction('BAN', target, member, reason);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#c0392b').setTitle('🔨 Member Banned')
            .addFields({ name: 'User', value: target.user.tag }, { name: 'Reason', value: reason }).setTimestamp()] });
    }

    if (commandName === 'unban') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const userId = interaction.options.getString('userid');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        try {
            await guild.members.unban(userId, reason);
            logAction('UNBAN', userId, member, reason);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('✅ User Unbanned')
                .addFields({ name: 'User ID', value: userId }, { name: 'Reason', value: reason }).setTimestamp()] });
        } catch {
            return interaction.reply({ content: '❌ Could not unban. Make sure the user ID is correct.', ephemeral: true });
        }
    }

    if (commandName === 'tempban') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const hours = interaction.options.getInteger('hours');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        if (!target?.bannable) return interaction.reply({ content: '❌ I cannot ban this user.', ephemeral: true });
        await target.ban({ reason: `Tempban (${hours}h): ${reason}` });
        logAction('TEMPBAN', target, member, `${hours}h — ${reason}`);
        setTimeout(async () => { try { await guild.members.unban(target.id, 'Tempban expired'); } catch {} }, hours * 3600000);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#e67e22').setTitle('⏱️ Member Temp Banned')
            .addFields({ name: 'User', value: target.user.tag }, { name: 'Duration', value: `${hours} hour(s)` }, { name: 'Reason', value: reason }).setTimestamp()] });
    }

    if (commandName === 'mute') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const minutes = interaction.options.getInteger('minutes');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        await target.timeout(minutes * 60000, reason);
        logAction('MUTE', target, member, `${minutes}m — ${reason}`);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f39c12').setTitle('🔇 Member Muted')
            .addFields({ name: 'User', value: target.user.tag }, { name: 'Duration', value: `${minutes} minute(s)` }, { name: 'Reason', value: reason }).setTimestamp()] });
    }

    if (commandName === 'unmute') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        await target.timeout(null);
        logAction('UNMUTE', target, member, 'Timeout removed');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('🔊 Member Unmuted')
            .addFields({ name: 'User', value: target.user.tag }).setTimestamp()] });
    }

    if (commandName === 'warn') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason');
        const uid = target.user.id;
        if (!warnings.has(uid)) warnings.set(uid, []);
        warnings.get(uid).push({ reason, mod: member.user.tag, date: new Date() });
        logAction('WARN', target, member, reason);
        try { await target.user.send(`⚠️ You were warned in **${guild.name}**.\n**Reason:** ${reason}`); } catch {}
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f39c12').setTitle('🟨 Warning Issued')
            .addFields({ name: 'User', value: target.user.tag }, { name: 'Reason', value: reason }, { name: 'Total Warnings', value: `${warnings.get(uid).length}` }).setTimestamp()] });
    }

    if (commandName === 'warnings') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getUser('user');
        const userWarnings = warnings.get(target.id) || [];
        if (!userWarnings.length) return interaction.reply({ content: `✅ **${target.tag}** has no warnings.`, ephemeral: true });
        const list = userWarnings.map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.mod} on ${w.date.toDateString()}`).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#f39c12').setTitle(`⚠️ Warnings for ${target.tag}`).setDescription(list).setTimestamp()], ephemeral: true });
    }

    if (commandName === 'clearwarnings') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getUser('user');
        warnings.delete(target.id);
        logAction('CLEARWARNINGS', target.tag, member, 'All warnings cleared');
        return interaction.reply({ content: `✅ Cleared all warnings for **${target.tag}**.`, ephemeral: true });
    }

    if (commandName === 'purge') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        const deleted = await channel.bulkDelete(amount, true);
        logAction('PURGE', `#${channel.name}`, member, `Deleted ${deleted.size} messages`);
        return interaction.reply({ content: `🗑️ Deleted **${deleted.size}** messages.`, ephemeral: true });
    }

    if (commandName === 'nick') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const nick = interaction.options.getString('nickname') || null;
        await target.setNickname(nick);
        return interaction.reply({ content: nick ? `✅ Set **${target.user.tag}**'s nickname to **${nick}**.` : `✅ Reset **${target.user.tag}**'s nickname.`, ephemeral: true });
    }

    if (commandName === 'roleadd') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const role = interaction.options.getRole('role');
        await target.roles.add(role);
        return interaction.reply({ content: `✅ Added **${role.name}** to **${target.user.tag}**.` });
    }

    if (commandName === 'roleremove') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getMember('user');
        const role = interaction.options.getRole('role');
        await target.roles.remove(role);
        return interaction.reply({ content: `✅ Removed **${role.name}** from **${target.user.tag}**.` });
    }

    if (commandName === 'lock') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getChannel('channel') || channel;
        await target.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
        logAction('LOCK', `#${target.name}`, member);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('🔒 Channel Locked')
            .setDescription(`<#${target.id}> has been locked.`).setTimestamp()] });
    }

    if (commandName === 'unlock') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const target = interaction.options.getChannel('channel') || channel;
        await target.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
        logAction('UNLOCK', `#${target.name}`, member);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('🔓 Channel Unlocked')
            .setDescription(`<#${target.id}> has been unlocked.`).setTimestamp()] });
    }

    if (commandName === 'slowmode') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const seconds = interaction.options.getInteger('seconds');
        const target = interaction.options.getChannel('channel') || channel;
        await target.setRateLimitPerUser(seconds);
        return interaction.reply({ content: seconds === 0 ? `✅ Slowmode disabled in <#${target.id}>.` : `✅ Slowmode set to **${seconds}s** in <#${target.id}>.` });
    }

    if (commandName === 'announce') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const msg = interaction.options.getString('message');
        const title = interaction.options.getString('title') || '📢 Announcement';
        const target = interaction.options.getChannel('channel') || channel;
        const embed = new EmbedBuilder().setColor('#3498db').setTitle(title).setDescription(msg)
            .setFooter({ text: `Announced by ${member.user.tag}` }).setTimestamp();
        await target.send({ embeds: [embed] });
        return interaction.reply({ content: `✅ Announcement sent to <#${target.id}>.`, ephemeral: true });
    }

    if (commandName === 'logs') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const amount = interaction.options.getInteger('amount') || 10;
        if (!modLogs.length) return interaction.reply({ content: 'No moderation logs yet.', ephemeral: true });
        const list = modLogs.slice(0, amount).map((l, i) =>
            `**${i + 1}.** \`${l.action}\` — **${l.target}** by **${l.mod}**\n↳ ${l.reason} • ${l.date.toDateString()}`
        ).join('\n\n');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('📋 Moderation Logs').setDescription(list).setTimestamp()], ephemeral: true });
    }

    if (commandName === 'report') {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const reportChannel = guild.channels.cache.find(c => ['reports', 'mod-reports', 'staff-reports'].includes(c.name));
        const embed = new EmbedBuilder().setColor('#e74c3c').setTitle('🚨 New Report')
            .addFields(
                { name: 'Reported User', value: `${target.tag} (${target.id})` },
                { name: 'Reported By', value: `${interaction.user.tag}` },
                { name: 'Reason', value: reason }
            ).setTimestamp();
        if (reportChannel) {
            await reportChannel.send({ embeds: [embed] });
            return interaction.reply({ content: '✅ Your report has been submitted to staff anonymously.', ephemeral: true });
        }
        return interaction.reply({ content: '⚠️ No reports channel found. Please contact a staff member directly.', ephemeral: true });
    }

    // ══ INFO ══════════════════════════════════════════════════════════════

    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        return interaction.editReply({ content: '', embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🏓 Pong!')
            .addFields(
                { name: 'Roundtrip', value: `${sent.createdTimestamp - interaction.createdTimestamp}ms`, inline: true },
                { name: 'API Latency', value: `${client.ws.ping}ms`, inline: true }
            ).setTimestamp()] });
    }

    if (commandName === 'uptime') {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('⏱️ Bot Uptime')
            .setDescription(`The bot has been online for **${formatDuration(Date.now() - startTime)}**`).setTimestamp()] });
    }

    if (commandName === 'botinfo') {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle(`ℹ️ ${client.user.username}`)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: 'Users', value: `${client.users.cache.size}`, inline: true },
                { name: 'Uptime', value: formatDuration(Date.now() - startTime), inline: true },
                { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
                { name: 'Commands', value: `${commands.length}`, inline: true },
                { name: 'Library', value: 'discord.js v14', inline: true }
            ).setTimestamp()] });
    }

    if (commandName === 'serverinfo') {
        await guild.fetch();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`🌐 ${guild.name}`)
            .setThumbnail(guild.iconURL())
            .addFields(
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Members', value: `${guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'Boosts', value: `${guild.premiumSubscriptionCount}`, inline: true },
                { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'Verification Level', value: `${guild.verificationLevel}`, inline: true }
            ).setTimestamp()] });
    }

    if (commandName === 'userinfo') {
        const target = interaction.options.getMember('user') || member;
        const u = target.user;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`👤 ${u.tag}`)
            .setThumbnail(u.displayAvatarURL())
            .addFields(
                { name: 'ID', value: u.id, inline: true },
                { name: 'Nickname', value: target.nickname || 'None', inline: true },
                { name: 'Bot?', value: u.bot ? 'Yes' : 'No', inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'Roles', value: `${target.roles.cache.size - 1}`, inline: true }
            ).setTimestamp()] });
    }

    if (commandName === 'roles') {
        const target = interaction.options.getMember('user') || member;
        const roleList = target.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`).join(', ') || 'None';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`🎭 Roles for ${target.user.tag}`).setDescription(roleList).setTimestamp()] });
    }

    if (commandName === 'avatar') {
        const target = interaction.options.getUser('user') || interaction.user;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`🖼️ ${target.tag}'s Avatar`)
            .setImage(target.displayAvatarURL({ size: 1024 })).setTimestamp()] });
    }

    if (commandName === 'channelinfo') {
        const target = interaction.options.getChannel('channel') || channel;
        const typeMap = { 0: 'Text', 2: 'Voice', 4: 'Category', 5: 'Announcement', 13: 'Stage', 15: 'Forum' };
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`📺 #${target.name}`)
            .setDescription(target.topic || 'No topic set')
            .addFields(
                { name: 'ID', value: target.id, inline: true },
                { name: 'Type', value: typeMap[target.type] || 'Unknown', inline: true },
                { name: 'Category', value: target.parent?.name || 'None', inline: true },
                { name: 'Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'Slowmode', value: target.rateLimitPerUser ? `${target.rateLimitPerUser}s` : 'Off', inline: true },
                { name: 'NSFW', value: target.nsfw ? 'Yes' : 'No', inline: true }
            ).setTimestamp()] });
    }

    if (commandName === 'invite') {
        const link = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('🔗 Invite the Bot')
            .setDescription(`[Click here to invite me to your server!](${link})`).setTimestamp()] });
    }

    if (commandName === 'randommember') {
        await guild.members.fetch();
        const humans = guild.members.cache.filter(m => !m.user.bot);
        const random = humans.random();
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('🎲 Random Member')
            .setDescription(`The lucky member is... **${random.user.tag}**!`)
            .setThumbnail(random.user.displayAvatarURL()).setTimestamp()] });
    }

    if (commandName === 'countroles') {
        await guild.members.fetch();
        const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
        const list = roles.map(r => `**${r.name}:** ${r.members.size}`).slice(0, 20).join('\n');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle('📊 Role Member Counts').setDescription(list || 'No roles found').setTimestamp()] });
    }

    if (commandName === 'vote') {
        const question = interaction.options.getString('question');
        const embed = new EmbedBuilder().setColor('#3498db').setTitle('🗳️ Quick Vote').setDescription(`**${question}**`)
            .setFooter({ text: `Vote with the reactions below!` }).setTimestamp();
        const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
        await msg.react('✅');
        await msg.react('❌');
    }

    if (commandName === 'say') {
        if (!hasMod(member)) return interaction.reply({ content: '❌ You need the **Match Officials** role.', ephemeral: true });
        const msg = interaction.options.getString('message');
        const target = interaction.options.getChannel('channel') || channel;
        await target.send(msg);
        return interaction.reply({ content: '✅ Message sent.', ephemeral: true });
    }

    if (commandName === 'serverbanner') {
        await guild.fetch();
        const banner = guild.bannerURL({ size: 1024 });
        if (!banner) return interaction.reply({ content: '❌ This server does not have a banner.', ephemeral: true });
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`🖼️ ${guild.name}'s Banner`).setImage(banner).setTimestamp()] });
    }

    // ══ FOOTBALL ══════════════════════════════════════════════════════════

    if (commandName === 'scores') {
        await interaction.deferReply();
        const league = interaction.options.getString('league');
        try {
            const data = await fetchFootball(`fixtures?league=${LEAGUE_IDS[league]}&last=5`);
            if (!data.response?.length) return interaction.editReply('No recent fixtures found.');
            const embed = new EmbedBuilder().setColor('#1abc9c').setTitle(`⚽ ${LEAGUE_NAMES[league]} — Recent Scores`).setTimestamp();
            data.response.slice(0, 8).forEach(f => {
                const elapsed = f.fixture.status.elapsed ? `${f.fixture.status.elapsed}'` : f.fixture.status.short;
                embed.addFields({ name: `${f.teams.home.name} vs ${f.teams.away.name}`, value: `**${f.goals.home ?? '-'} - ${f.goals.away ?? '-'}** (${elapsed})`, inline: true });
            });
            return interaction.editReply({ embeds: [embed] });
        } catch { return interaction.editReply('❌ Failed to fetch scores. Check your FOOTBALL_API_KEY in .env'); }
    }

    if (commandName === 'standings') {
        await interaction.deferReply();
        const league = interaction.options.getString('league');
        try {
            const data = await fetchFootball(`standings?league=${LEAGUE_IDS[league]}&season=${new Date().getFullYear()}`);
            const table = data.response?.[0]?.league?.standings?.[0];
            if (!table) return interaction.editReply('❌ Could not fetch standings.');
            const rows = table.slice(0, 10).map(t =>
                `\`${String(t.rank).padStart(2)}.\` **${t.team.name}** — ${t.points}pts (${t.all.win}W ${t.all.draw}D ${t.all.lose}L)`
            ).join('\n');
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#f39c12').setTitle(`🏆 ${LEAGUE_NAMES[league]} — Top 10`).setDescription(rows).setTimestamp()] });
        } catch { return interaction.editReply('❌ Failed to fetch standings. Check your FOOTBALL_API_KEY in .env'); }
    }

    if (commandName === 'player') {
        await interaction.deferReply();
        const name = interaction.options.getString('name');
        try {
            const data = await fetchFootball(`players?search=${encodeURIComponent(name)}&season=${new Date().getFullYear()}`);
            const player = data.response?.[0];
            if (!player) return interaction.editReply(`❌ No player found for **${name}**.`);
            const p = player.player, stats = player.statistics?.[0];
            return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#3498db').setTitle(`👤 ${p.firstname} ${p.lastname}`)
                .setThumbnail(p.photo)
                .addFields(
                    { name: 'Age', value: `${p.age}`, inline: true },
                    { name: 'Nationality', value: p.nationality || 'N/A', inline: true },
                    { name: 'Club', value: stats?.team?.name || 'N/A', inline: true },
                    { name: 'Position', value: stats?.games?.position || 'N/A', inline: true },
                    { name: 'Appearances', value: `${stats?.games?.appearences ?? 0}`, inline: true },
                    { name: 'Goals', value: `${stats?.goals?.total ?? 0}`, inline: true },
                    { name: 'Assists', value: `${stats?.goals?.assists ?? 0}`, inline: true },
                    { name: 'Yellow Cards', value: `${stats?.cards?.yellow ?? 0}`, inline: true },
                    { name: 'Red Cards', value: `${stats?.cards?.red ?? 0}`, inline: true }
                ).setTimestamp()] });
        } catch { return interaction.editReply('❌ Failed to fetch player. Check your FOOTBALL_API_KEY in .env'); }
    }

    if (commandName === 'trivia') {
        if (activeTrivia.has(channel.id)) return interaction.reply({ content: '❌ There is already an active trivia question here!', ephemeral: true });
        const q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
        const timeout = setTimeout(() => {
            activeTrivia.delete(channel.id);
            channel.send({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('⏰ Time\'s Up!').setDescription(`Nobody got it! The answer was **${q.display}**`)] });
        }, 30000);
        activeTrivia.set(channel.id, { ...q, timeout });
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9b59b6').setTitle('🧠 Football Trivia!')
            .setDescription(q.question).setFooter({ text: 'Use /answer — You have 30 seconds!' }).setTimestamp()] });
    }

    if (commandName === 'answer') {
        const trivia = activeTrivia.get(channel.id);
        if (!trivia) return interaction.reply({ content: '❌ No active trivia! Use /trivia to start one.', ephemeral: true });
        const userAnswer = interaction.options.getString('answer').toLowerCase().trim();
        if (userAnswer.includes(trivia.answer) || trivia.answer.includes(userAnswer)) {
            clearTimeout(trivia.timeout);
            activeTrivia.delete(channel.id);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('✅ Correct!')
                .setDescription(`**${interaction.user.username}** got it! The answer was **${trivia.display}** 🏆`)] });
        }
        return interaction.reply({ content: '❌ Wrong answer, keep trying!', ephemeral: true });
    }
});

// ─── Ready ─────────────────────────────────────────────────────────────────
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setActivity('The Footballing World ⚽', { type: ActivityType.Watching });
    registerCommands();
});

client.login(process.env.TOKEN);
