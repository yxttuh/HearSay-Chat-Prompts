const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const tmi = require('tmi.js');

let mainWindow;
let client;
let promptQueue = [];
const maxSlots = 120;

function createWindow() {
    // When embedded, we use __dirname to point to the internal ASAR archive
    mainWindow = new BrowserWindow({
        width: 450, 
        height: 600,
        resizable: false, 
        autoHideMenuBar: true, 
        icon: path.join(__dirname, 'icon.ico'), 
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    mainWindow.loadFile('index.html');
}

ipcMain.on('select-dirs', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (!result.canceled) {
        const selectedPath = result.filePaths[0];
        const targetPath = path.join(selectedPath, 'games', 'MicGame', 'content', 'en');
        
        if (fs.existsSync(targetPath)) {
            global.selectedGameDir = targetPath;
            event.reply('dir-selected-success', targetPath);
        } else {
            event.reply('dir-selected-error', "Invalid Folder: Please select the main 'The Jackbox Party Pack 11' folder.");
        }
    }
});

ipcMain.on('start-bot', (event, { channel, gameDir }) => {
    global.selectedGameDir = gameDir;
    if (client) client.disconnect();
    client = new tmi.Client({ channels: [channel] });
    client.connect().then(() => { event.reply('bot-connected'); }).catch(e => console.error(e));

    client.on('message', (chan, tags, message, self) => {
        if (self) return;
        const isAllowed = tags.mod || tags.subscriber || (tags.badges && (tags.badges.vip || tags.badges.broadcaster));
        if (message.toLowerCase().startsWith('!prompt ') && isAllowed) {
            const newText = message.slice(8).trim();
            processNewPrompt(newText);
        }
    });
});

ipcMain.on('remove-prompt', (event, index) => {
    if (index > -1 && index < promptQueue.length) {
        promptQueue.splice(index, 1);
        if (global.selectedGameDir) updateGameFile(global.selectedGameDir);
        mainWindow.webContents.send('refresh-list', promptQueue);
    }
});

function processNewPrompt(text) {
    if (text && promptQueue.length < maxSlots) {
        promptQueue.push(text);
        if (global.selectedGameDir) {
            updateGameFile(global.selectedGameDir);
            mainWindow.webContents.send('new-prompt', { text: text, count: promptQueue.length });
        }
    }
}

function updateGameFile(gameDir) {
    try {
        const targetFile = path.join(gameDir, 'MicGamePrompt.jet');
        
        // Use __dirname to read the file from the internal app bundle
        const sourcePath = path.join(__dirname, 'samples.jet');

        if (!fs.existsSync(sourcePath)) {
            console.error("samples.jet not found inside the app bundle!");
            return;
        }

        let fileContent = fs.readFileSync(sourcePath, 'utf8');
        promptQueue.forEach((text, index) => {
            const currentSlot = index + 1;
            const searchRegex = new RegExp(`prompt sample ${currentSlot}\\b`, 'gi');
            fileContent = fileContent.replace(searchRegex, text);
        });

        // We write to the external Jackbox directory
        fs.writeFileSync(targetFile, fileContent, 'utf8');
    } catch (err) {
        console.error("File Write Error:", err.message);
    }
}

ipcMain.on('clear-prompts', () => { 
    promptQueue = []; 
    if (global.selectedGameDir) updateGameFile(global.selectedGameDir);
});

app.whenReady().then(createWindow);