// Import necessary modules
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const fetch = require('node-fetch');

// --- Configuration ---
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // <-- IMPORTANT: Add your Bot's Client ID as an environment variable

// Roblox API URLs
const ROBLOX_CATALOG_API_URL = 'https://catalog.roblox.com/v1/search/items?category=Characters&subcategory=Bundles&sortType=3&sortOrder=Desc&limit=10';
const ROBLOX_ITEM_DETAILS_API_URL = 'https://catalog.roblox.com/v1/items/details';
const ROBLOX_THUMBNAILS_API_URL = 'https://thumbnails.roblox.com/v1/bundles/thumbnails';
const CHECK_INTERVAL_MS = 1 * 60 * 1000; // 1 minute

// --- Global State ---
let lastKnownBundleIds = new Set();

// --- Discord Bot Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- Helper Function: Slugify Name for URL ---
function slugify(name) {
    if (!name) return '';
    return name.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

/**
 * Fetches bundle details, creates an embed, and sends it.
 * Can be used by both automatic checks and slash commands.
 * @param {string|number} bundleId The ID of the bundle to post.
 * @param {import('discord.js').Interaction|null} interaction The interaction object if triggered by a command.
 */
async function createAndSendBundleEmbed(bundleId, interaction = null) {
    try {
        // Step 1: Fetch bundle details from Roblox API
        const detailsResponse = await fetch(ROBLOX_ITEM_DETAILS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ items: [{ itemType: 'Bundle', id: parseInt(bundleId) }] })
        });

        if (!detailsResponse.ok) throw new Error(`Item Details API returned status ${detailsResponse.status}`);
        
        const detailsData = await detailsResponse.json();
        const bundle = detailsData.data?.[0];

        if (!bundle) {
            const errorMessage = `Could not find a bundle with ID \`${bundleId}\`. It might be invalid or off-sale.`;
            if (interaction) await interaction.editReply({ content: errorMessage, ephemeral: true });
            else console.error(errorMessage);
            return;
        }

        // Step 2: Fetch bundle thumbnail
        const thumbnailResponse = await fetch(`${ROBLOX_THUMBNAILS_API_URL}?bundleIds=${bundleId}&size=420x420&format=Png`);
        const thumbnailData = await thumbnailResponse.json();
        const thumbnailUrl = thumbnailData.data?.[0]?.imageUrl || '';

        // Step 3: Construct the Embed
        const bundleSlug = slugify(bundle.name);
        const bundleLink = `https://www.roblox.com/bundles/${bundle.id}/${bundleSlug || '-'}`;

        let priceString = 'N/A';
        if (bundle.priceStatus === 'Free') {
            priceString = 'Free';
        } else if (bundle.price) {
            priceString = `${bundle.price} Robux`;
        } else if (bundle.priceStatus === "Off-Sale") {
            priceString = 'Off-Sale';
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(bundle.name || 'Unknown Bundle')
            .setURL(bundleLink)
            .setDescription(bundle.description || 'No description available.')
            .setThumbnail(thumbnailUrl)
            .addFields(
                { name: 'Price', value: priceString, inline: true },
                { name: 'Creator', value: `[${bundle.creatorName}](${bundle.creatorProfileLink})` || 'N/A', inline: true }
            )
            .setTimestamp(new Date(bundle.updated))
            .setFooter({ text: 'Bundle Notifier', iconURL: 'https://i.imgur.com/s4p4b9c.png' });

        // Step 4: Send the embed
        if (interaction) {
            await interaction.editReply({ embeds: [embed] });
        } else {
            const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) await channel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error(`Failed to create embed for bundle ${bundleId}:`, error);
        if (interaction) {
            await interaction.editReply({ content: `🚨 An error occurred while fetching bundle \`${bundleId}\`: ${error.message}`, ephemeral: true });
        }
    }
}


// --- Function to Check for New Roblox Bundles ---
async function checkForNewBundles() {
    console.log('Checking for new Roblox bundles...');
    try {
        const response = await fetch(ROBLOX_CATALOG_API_URL);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        const currentBundles = data.data || [];

        if (lastKnownBundleIds.size === 0 && currentBundles.length > 0) {
            currentBundles.forEach(bundle => lastKnownBundleIds.add(bundle.id));
            console.log(`Initial scan complete. Found ${lastKnownBundleIds.size} bundles. Monitoring for new ones.`);
            return;
        }

        const newBundles = currentBundles.filter(bundle => !lastKnownBundleIds.has(bundle.id));

        if (newBundles.length > 0) {
            console.log(`Found ${newBundles.length} new bundle(s)!`);
            for (const bundle of newBundles) {
                lastKnownBundleIds.add(bundle.id);
                // Use the new reusable function to post the embed
                await createAndSendBundleEmbed(bundle.id);
            }
        } else {
            console.log('No new bundles found.');
        }

    } catch (error) {
        console.error('Error checking for new Roblox bundles:', error);
    }
}


// --- Discord Bot Event Handling ---
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // --- Slash Command Registration ---
    if (!CLIENT_ID || !DISCORD_BOT_TOKEN) {
        console.error("FATAL: CLIENT_ID or DISCORD_BOT_TOKEN is missing. Cannot register commands.");
        return;
    }
    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
    const commands = [
        new SlashCommandBuilder()
            .setName('debugsend')
            .setDescription('Fetches and posts a bundle embed by its ID.')
            .addStringOption(option =>
                option.setName('id')
                .setDescription('The Roblox bundle ID to post.')
                .setRequired(false)) // Optional parameter
            .toJSON(),
    ];

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
    // --- End Command Registration ---

    // Initial check and interval setup
    await checkForNewBundles();
    setInterval(checkForNewBundles, CHECK_INTERVAL_MS);
    console.log(`Scheduled to check for new bundles every ${CHECK_INTERVAL_MS / 60000} minute(s).`);
});


// --- Listen for Slash Command Interactions ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'debugsend') {
        // Get the 'id' option, or default to '126' if not provided
        const bundleId = interaction.options.getString('id') ?? '126';
        
        // Let Discord know we've received the command and are working on it
        await interaction.deferReply();

        // Use the refactored function to handle the logic
        await createAndSendBundleEmbed(bundleId, interaction);
    }
});

// Log in to Discord
if (DISCORD_BOT_TOKEN) {
    client.login(DISCORD_BOT_TOKEN);
} else {
    console.error('FATAL: DISCORD_BOT_TOKEN is not set. Please set it as an environment variable.');
}
