const uuid = require('uuid');
const {app, ipcMain} = require("electron");
const fs = require("fs");
const path = require("path");

const defaultConfig = {
    size: 250,
    position: 1,
    opacity: 0.5,
    id: uuid.v4(),
    draggable: false,
    hideOverlay: false,
    token: "",
    minimizeToTray: false,
    disableFaqPopup: false,
    rotation: 0,
    monitor: 0,
    overlayX: null,
    overlayY: null,
    mapDetection: false,
    ocrLanguage: 'all',
    preferredCreator: '',
    navigationMoveSpeed: 0.035,
    navigationMouseSensitivity: 0.135,
    navigationSensitivityRevision: 1
};

class Settings {

    settings = {};

    constructor() {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "settings-app.json")
        if (!fs.existsSync(fileDir)) {
            fs.writeFileSync(fileDir, JSON.stringify(defaultConfig))
        }
        this.settings = JSON.parse(fs.readFileSync(fileDir, "utf-8"));
        let settingsChanged = false;
        if (this.settings.navigationSensitivityRevision !== 1) {
            if (Number(this.settings.navigationMouseSensitivity) === 0.15) {
                this.settings.navigationMouseSensitivity = 0.135;
            }
            this.settings.navigationSensitivityRevision = 1;
            settingsChanged = true;
        }
        for (let key in defaultConfig) {
            if (this.settings[key] === undefined) {
                this.settings[key] = defaultConfig[key]
                settingsChanged = true;
            }
        }
        if (settingsChanged) {
            fs.writeFileSync(fileDir, JSON.stringify(this.settings))
        }
        let classInstance = this;
        ipcMain.handle('get-settings', async (event) => {
            return classInstance.settings
        })
        ipcMain.handle('save-settings', async (event, settings) => {
            if (settings !== null) {
                classInstance.save(settings)
            }
        })
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.save(this.settings);
    }

    save(settings) {
        const userdata = app.getPath('userData');
        const fileDir = path.join(userdata, "settings-app.json")
        fs.writeFileSync(fileDir, JSON.stringify(settings))
        this.settings = settings;
    }

}

module.exports = Settings;
