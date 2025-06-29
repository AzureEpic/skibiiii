// Import necessary modules
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch'); // For making HTTP requests to Roblox API

// --- Configuration ---
// IMPORTANT: These values are now read from environment variables for security.
// You will set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in your hosting platform's
// environment variable settings (e.g., Replit Secrets, Railway Variables).
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Roblox Catalog API URL for recently published bundles
const ROBLOX_CATALOG_API_URL = 'https://catalog.roblox.com/v1/search/items?category=Characters&subcategory=Bundles&sortType=3&sortOrder=Desc&limit=10';
// Roblox Thumbnails API URL
const ROBLOX_THUMBNAILS_API_URL = 'https://thumbnails.roblox.com/v1/bundles/thumbnails';
const CHECK_INTERVAL_MS = 1 * 60 * 1000; // Check every minute

// --- Global State ---
// This stores the IDs of bundles we've already notified about.
// For a production bot, this should be stored in a database (e.g., Firestore, SQLite).
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
/**
 * Converts a string into a URL-friendly slug.
 * e.g., "My Awesome Bundle!" -> "my-awesome-bundle"
 * @param {string} name The string to convert.
 * @returns {string} The URL-friendly slug.
 */
function slugify(name) {
    if (!name) return '';
    return name.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w-]+/g, '')     // Remove all non-word chars except -
        .replace(/--+/g, '-')          // Replace multiple - with single -
        .replace(/^-+/, '')            // Trim - from start of text
        .replace(/-+$/, '');           // Trim - from end of text
}


// --- Helper Function: Send Message to Discord Channel ---
/**
 * Sends a message or an embed to the configured Discord channel.
 * @param {object} payload The message payload, typically { embeds: [embed] }.
 */
async function sendMessage(payload) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
        console.error('Error: Discord Bot Token or Channel ID are not set. Cannot send message.');
        return;
    }
    try {
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel) {
            await channel.send(payload);
            console.log(`Embed sent to Discord channel ${DISCORD_CHANNEL_ID}.`);
        } else {
            console.error(`Error: Could not find Discord channel with ID ${DISCORD_CHANNEL_ID}.`);
        }
    } catch (error) {
        console.error(`Failed to send message to Discord:`, error);
    }
}

// --- Function to Check for New Roblox Bundles ---
/**
 * Fetches recent bundles from the Roblox API, finds new ones, and posts them.
 */
async function checkForNewBundles() {
    console.log('Checking for new Roblox bundles...');
    try {
        const response = await fetch(ROBLOX_CATALOG_API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        const currentBundles = data.data || [];

        // If this is the first check, populate the list without notifying
        if (lastKnownBundleIds.size === 0 && currentBundles.length > 0) {
            currentBundles.forEach(bundle => lastKnownBundleIds.add(bundle.id));
            console.log(`Initial scan complete. Found ${lastKnownBundleIds.size} bundles. Monitoring for new ones.`);
            return;
        }

        const newBundles = currentBundles.filter(bundle => !lastKnownBundleIds.has(bundle.id));

        if (newBundles.length > 0) {
            console.log(`Found ${newBundles.length} new bundle(s)!`);
            
            // --- Fetch all thumbnails in one efficient API call ---
            const newBundleIds = newBundles.map(b => b.id);
            const thumbnailResponse = await fetch(`${ROBLOX_THUMBNAILS_API_URL}?bundleIds=${newBundleIds.join(',')}&size=420x420&format=Png`);
            const thumbnailData = await thumbnailResponse.json();
            const thumbnailMap = new Map(thumbnailData.data.map(t => [t.bundleId, t.imageUrl]));

            for (const bundle of newBundles) {
                // Add the new bundle to our set of known bundles
                lastKnownBundleIds.add(bundle.id);

                // Create a clean URL slug from the bundle name
                const bundleSlug = slugify(bundle.name);
                const bundleLink = `https://www.roblox.com/bundles/${bundle.id}/${bundleSlug || '-'}`;
                const thumbnailUrl = thumbnailMap.get(bundle.id) || ''; // Get thumbnail from our map
                
                // Determine the price string
                let priceString = 'N/A';
                if (bundle.priceStatus === 'Free') {
                    priceString = 'Free';
                } else if (bundle.price) {
                    priceString = `${bundle.price} Robux`;
                }

                // --- Create the Discord Embed ---
                const embed = new EmbedBuilder()
                    .setColor('#0099ff') // A nice blue color
                    .setTitle(bundle.name || 'Unknown Bundle')
                    .setURL(bundleLink)
                    .setDescription(bundle.description || 'No description available.')
                    .setThumbnail(thumbnailUrl) // The bundle's image
                    .addFields(
                        { name: 'Price', value: priceString, inline: true },
                        { name: 'Link', value: `[View on Roblox](${bundleLink})`, inline: true }
                    )
                    .setTimestamp(new Date())
                    .setFooter({ text: 'Roblox Bundle Notifier', iconURL: 'https://i.imgur.com/s4p4b9c.png' }); // A generic bot icon

                await sendMessage({ embeds: [embed] });
            }
        } else {
            console.log('No new bundles found.');
        }

    } catch (error) {
        console.error('Error checking for new Roblox bundles:', error);
        // Avoid sending error message on initial startup if API fails
        if (lastKnownBundleIds.size > 0) {
           await sendMessage({ content: `🚨 Alert: Failed to check for new Roblox bundles! Error: \`${error.message}\`` });
        }
    }
}

// --- Discord Bot Event Handling ---
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    // Perform an initial check immediately upon bot startup
    await checkForNewBundles();
    // Set up the interval to check regularly
    setInterval(checkForNewBundles, CHECK_INTERVAL_MS);
    console.log(`Scheduled to check for new bundles every ${CHECK_INTERVAL_MS / 60000} minute(s).`);
});

// Log in to Discord
if (DISCORD_BOT_TOKEN) {
    client.login(DISCORD_BOT_TOKEN);
} else {
    console.error('FATAL: DISCORD_BOT_TOKEN is not set. Please set it as an environment variable.');
}
