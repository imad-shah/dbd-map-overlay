'use strict';

class WindowsCursor {
    constructor() {
        if (process.platform !== 'win32') {
            throw new Error('Windows cursor control is only available on Windows.');
        }
        const koffi = require('koffi');
        this.user32 = koffi.load('user32.dll');
        this.setCursorPos = this.user32.func('int __stdcall SetCursorPos(int x, int y)');
    }

    moveTo(x, y) {
        return Boolean(this.setCursorPos(Math.round(x), Math.round(y)));
    }
}

module.exports = WindowsCursor;
