const Discord = require('discord.js');
const client = new Discord.Client({ intents: ["GUILDS", "GUILD_MESSAGES", "GUILD_VOICE_STATES"] });
const fs = require('fs');
const db = require("quick.db");
const path = require('path');
client.commands = new Discord.Collection();
const ayar = require('./Settings/config.json');
global.conf = ayar;
const prefix = ayar.prefix;

client.activityData = new Map();
const activityFilePath = path.join(__dirname, 'activity.json');

// Aktivite verilerini yükler
function loadActivityData() {
  if (!fs.existsSync(activityFilePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(activityFilePath));
}

// Aktivite verilerini kaydeder
function saveActivityData(data) {
  fs.writeFileSync(activityFilePath, JSON.stringify(data, null, 2));
}

// Komutları yüklüyoruz
const commandFiles = fs.readdirSync('./commands/').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}

// Silinen mesajları saklamak için event
client.on('messageDelete', (message) => {
  if (message.author.bot || !message.content) return;
  client.snipeData.set(message.channel.id, {
    content: message.content,
    author: message.author.tag,
    timestamp: message.createdTimestamp
  });
});

// Ses kanalına girip çıkan kullanıcıları takip etmek için event
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member.bot) return;
  const userId = newState.id;

  const activityData = loadActivityData();
  if (!activityData[userId]) {
    activityData[userId] = { textMessages: 0, voiceTime: 0 };
  }

  if (oldState.channelId && !newState.channelId) {
    const joinTime = oldState.channel?.createdAt || new Date();
    const voiceDuration = (new Date() - joinTime) / 1000;
    activityData[userId].voiceTime += voiceDuration;
  }

  saveActivityData(activityData);
});

// Mesaj gönderilen kanal için etkinlik verilerini güncelleme
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const activityData = loadActivityData();
  if (!activityData[userId]) {
    activityData[userId] = { textMessages: 0, voiceTime: 0 };
  }

  activityData[userId].textMessages += 1;
  saveActivityData(activityData);
});

// Komutlar için cooldown ve yetki rolleri
const cooldowns = new Map();
const allowedRoles = ["1175111609253896292", "1276656435123454113", "1161317327376236564"];

client.on('message', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  // Kullanıcı istatistiklerini gösteren 'stat' komutu
  if (commandName === 'stat') {
    const userId = message.author.id;

    const activityData = loadActivityData();
    if (!activityData[userId]) {
      return message.channel.send('Hiç mesaj veya ses aktiviteniz yok.');
    }

    const userStats = activityData[userId];
    const sortedUsers = Object.entries(activityData)
      .sort(([, a], [, b]) => (b.voiceTime + b.textMessages) - (a.voiceTime + a.textMessages))
      .map(([userId, data]) => ({ userId, textMessages: data.textMessages, voiceTime: data.voiceTime }));

    const userRank = sortedUsers.findIndex(user => user.userId === userId) + 1;
    const userVoiceTime = Math.floor(userStats.voiceTime / 3600);

    return message.channel.send(
      `**${message.author.username}**'nin istatistikleri:\n` +
      `• Sesli kanal aktivitesi: ${userVoiceTime} saat\n` +
      `• Gönderilen mesaj sayısı: ${userStats.textMessages}\n` +
      `• Sıralama: #${userRank} (Toplam ${sortedUsers.length} kullanıcı arasında)`
    );
  }

  // Kullanıcı ismini değiştiren 'b' komutu
  if (commandName === 'b') {
    const newName = args.join(" ");
    
    if (!allowedRoles.some(role => message.member.roles.cache.has(role))) {
      return message.reply("İsmini değiştirebilmek için VIP olman veya sunucuya Boost basman gerekiyor.");
    }

    if (cooldowns.has(message.author.id)) {
      const remainingTime = ((cooldowns.get(message.author.id) - Date.now()) / 1000).toFixed(1);
      if (remainingTime > 0) {
        return message.reply(`İsmini tekrar değiştirebilmek için ${remainingTime} saniye beklemelisin.`);
      }
    }

    cooldowns.set(message.author.id, Date.now() + 15 * 60 * 1000);

    try {
      await message.member.setNickname(newName);
      message.reply(`İsmin başarıyla "**${newName}**" olarak değiştirildi!`);
    } catch (error) {
      console.error(error);
      message.reply("İsmin değiştirilirken bir hata oluştu, Tekrar dene..");
    }
  }

  // Kullanıcının ses kanalında durumunu gösteren 'n' komutu
  if (commandName === 'n') {
    if (!args[0]) {
      return message.reply("Bir kullanıcı etiketleyin veya kullanıcı ID'si girin.");
    }

    let member;
    try {
      member = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
    } catch (error) {
      return message.reply("Geçerli bir kullanıcı bulunamadı.");
    }

    if (!member.voice.channel) {
      return message.reply(`${member.user.tag} şu anda bir ses kanalında değil.`);
    }

    const voiceChannel = member.voice.channel;
    const joinTimestamp = member.voice.channel.joinedAt || new Date();
    const voiceDuration = ((Date.now() - joinTimestamp) / 1000 / 60 / 60).toFixed(2);

    const micStatus = member.voice.selfMute ? "Kapalı" : "Açık";
    const headphoneStatus = member.voice.selfDeaf ? "Kapalı" : "Açık";
    const streamStatus = member.voice.streaming ? "Yayında" : "Yayında Değil";

    return message.channel.send(
      `**${member.user.tag}** kullanıcısının ses bilgileri:\n` +
      `• Ses Kanalı: ${voiceChannel.name}\n` +
      `• Mikrofon Durumu: ${micStatus}\n` +
      `• Kulaklık Durumu: ${headphoneStatus}\n` +
      `• Yayın Durumu: ${streamStatus}\n` +
      `• Kanalda Kalma Süresi: ${voiceDuration} saat`
    );
  }

  // Kullanıcının mazeretini gösteren 'mazeret' komutu
  if (commandName === 'mazeret') {
    const mazeretData = db.get("mazeretler") || [];
    
    const mazeretList = mazeretData.map((item, index) => `${index + 1} - ${item.date} : ${item.reason}`).join("\n") || "Henüz mazeret bulunmuyor.";
    
    const mazeretEmbed = new Discord.MessageEmbed()
      .setColor("#0099ff")
      .setTitle("Mazeretler")
      .setDescription(mazeretList);

    const button = new Discord.MessageButton()
      .setCustomId('addMazeret')
      .setLabel("Mazeret Ekle")
      .setStyle('PRIMARY');

    const row = new Discord.MessageActionRow().addComponents(button);

    await message.channel.send({ embeds: [mazeretEmbed], components: [row] });
  }

  const command = client.commands.get(commandName) || client.commands.find(x => x.aliases && x.aliases.includes(commandName));
  if (command) {
    command.execute(client, message, args);
  }
});

// Butonla etkileşimi işleme
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'addMazeret') {
    const modal = new Discord.Modal()
      .setCustomId('mazeretModal')
      .setTitle('Mazeret Ekle')
      .addComponents(
        new Discord.MessageActionRow().addComponents(
          new Discord.TextInputComponent()
            .setCustomId('days')
            .setLabel('Kaç gün mazeret?')
            .setStyle('SHORT')
            .setRequired(true)
        ),
        new Discord.MessageActionRow().addComponents(
          new Discord.TextInputComponent()
            .setCustomId('reason')
            .setLabel('Mazeret Nedir?')
            .setStyle('PARAGRAPH')
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    interaction.reply({ content: "Mazeret eklendi!", ephemeral: true });
  }
});

client.login(process.env.token);
