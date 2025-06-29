// Import necessary modules
const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch'); // For making HTTP requests to Roblox API

// --- Configuration ---
// IMPORTANT: These values are now read from environment variables for security.
// You will set DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID in your hosting platform's
// environment variable settings (e.g., Replit Secrets, Railway Variables).
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Updated Roblox Catalog API URL for recently published bundles
// This URL uses the search/items endpoint with specific filters and sorting.
// - category=Characters: Bundles are typically classified under Characters.
// - subcategory=Bundles: Narrows down the search to bundles.
// - sortType=3: This parameter generally indicates sorting by 'Updated' or 'Recently Created/Published'.
// - sortOrder=Desc: Ensures the newest items appear first.
// - limit=10: Fetches 10 items per request.
const ROBLOX_CATALOG_API_URL = 'https://catalog.roblox.com/v1/search/items?category=Characters&subcategory=Bundles&sortType=3&sortOrder=Desc&limit=10';
const CHECK_INTERVAL_MS = 1 * 60 * 1000; // Check every minute (1 minute = 60,000 milliseconds)

// --- Global State ---
// This will store the IDs of the bundles we've already seen to avoid re-notifying.
// In a production environment, this should be persisted (e.g., in a database or a file)
// so that the bot remembers seen bundles even if it restarts.
let lastKnownBundleIds = new Set();

// --- Discord Bot Client Initialization ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,           // Required for accessing guild (server) information
        GatewayIntentBits.GuildMessages,    // Required for sending and receiving messages
        GatewayIntentBits.MessageContent    // Required for accessing message content (if needed, though not directly for this bot)
    ]
});

// --- Helper Function: Send Message to Discord Channel ---
/**
 * Sends a message to the configured Discord channel.
 * @param {string} message The message content to send.
 */
async function sendMessage(message) {
    // Ensure both token and channel ID are loaded before attempting to send.
    if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
        console.error('Error: Discord Bot Token or Channel ID are not set. Cannot send message.');
        return;
    }

    try {
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel) {
            await channel.send(message);
            console.log(`Message sent to Discord channel ${DISCORD_CHANNEL_ID}: "${message}"`);
        } else {
            console.error(`Error: Could not find Discord channel with ID ${DISCORD_CHANNEL_ID}.`);
        }
    } catch (error) {
        console.error(`Failed to send message to Discord:`, error);
    }
}

// --- Function to Check for New Roblox Bundles ---
/**
 * Fetches recent bundles from the Roblox API and identifies new ones.
 */
async function checkForNewBundles() {
    console.log('Checking for new Roblox bundles...');
    try {
        // Use the updated URL for GET request
        const response = await fetch(ROBLOX_CATALOG_API_URL, {
            method: 'GET', // Changed to GET method
            headers: {
                'Accept': 'application/json' // Indicate preference for JSON response
            }
            // No 'body' is needed for GET requests
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

        // Assuming the API returns an array of items under a 'data' key
        const currentBundles = data.data || [];

        // If this is the first check, populate lastKnownBundleIds without notifying
        if (lastKnownBundleIds.size === 0 && currentBundles.length > 0) {
            currentBundles.forEach(bundle => lastKnownBundleIds.add(bundle.id));
            console.log(`Initial scan complete. Found ${lastKnownBundleIds.size} bundles. No notifications sent.`);
            return; // Exit after initial population
        }

        const newBundles = [];
        currentBundles.forEach(bundle => {
            // Check if the bundle ID is new
            if (!lastKnownBundleIds.has(bundle.id)) {
                newBundles.push(bundle);
                lastKnownBundleIds.add(bundle.id); // Add to our known list
            }
        });

        if (newBundles.length > 0) {
            console.log(`Found ${newBundles.length} new bundle(s)!`);
            for (const bundle of newBundles) {
                // Constructing a generic catalog link. Note: Roblox URLs for bundles sometimes differ slightly
                // but `/bundles/{id}/-` is a common pattern that redirects to the correct page.
                const bundleLink = `https://www.roblox.com/bundles/${bundle.id}/-`;

                const message = `🎉 New Roblox Bundle Released! 🎉\n` +
                                `**Name:** ${bundle.name || 'N/A'}\n` +
                                `**Description:** ${bundle.description || 'No description provided.'}\n` +
                                `**Price:** ${bundle.price || 'Free'}\n` +
                                `**Link:** ${bundleLink}`;
                await sendMessage(message);
            }
        } else {
            console.log('No new bundles found.');
        }

    } catch (error) {
        console.error('Error checking for new Roblox bundles:', error);
        await sendMessage(`🚨 Alert: Failed to check for new Roblox bundles! Error: \`${error.message}\``);
    }
}

// --- Discord Bot Event Handling ---

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot ID: ${client.user.id}`);

    // Perform an initial check immediately upon bot startup
    await checkForNewBundles();

    // Set up the interval to check for new bundles regularly
    setInterval(checkForNewBundles, CHECK_INTERVAL_MS);
    console.log(`Scheduled to check for new bundles every ${CHECK_INTERVAL_MS / 1000 / 60} minutes.`);
});

// Log in to Discord. Ensure token is available.
if (DISCORD_BOT_TOKEN) {
    client.login(DISCORD_BOT_TOKEN);
} else {
    console.error('DISCORD_BOT_TOKEN is not set. Please set it as an environment variable.');
}

// --- Important Notes ---
// 1. Persistence: The `lastKnownBundleIds` set is reset every time the bot restarts.
//    For a production bot, you would need to save this state to a file or database
//    (like SQLite, MongoDB, or Firebase Firestore) and load it on startup.
// 2. Roblox API: The `ROBLOX_CATALOG_API_URL` has been updated to use
//    `catalog.roblox.com/v1/search/items` with `sortType=3` and `sortOrder=Desc`
//    to better target recently published bundles, similar to how the Roblox website
//    itself sorts.
// 3. Error Handling: The bot includes basic error handling for API requests and
//    Discord messaging, but robust error handling and logging are crucial for
//    long-running applications.
// 4. Rate Limits: Be mindful of Roblox API rate limits. Making requests every minute
//    might be too frequent and could lead to your bot being temporarily blocked
//    by Roblox. Consider increasing `CHECK_INTERVAL_MS` if you encounter issues.
// 5. Discord Permissions: Ensure your bot has the necessary permissions in your
//    Discord server (at least "Send Messages" and "Read Message History" in the target channel).
