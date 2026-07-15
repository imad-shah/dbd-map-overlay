'use strict';

const DEFAULT_MAX_MOUSE_DELTA = 250;
const DEFAULT_CURSOR_WRAP_MARGIN = 64;

function mouseDeltaFromPositions(previous, current, maxDelta = DEFAULT_MAX_MOUSE_DELTA) {
    if (!previous || !current) return null;
    const dx = Number(current.x) - Number(previous.x);
    const dy = Number(current.y) - Number(previous.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (Math.abs(dx) > maxDelta || Math.abs(dy) > maxDelta) return null;
    return {dx, dy};
}

function cursorWrapTarget(point, bounds, margin = DEFAULT_CURSOR_WRAP_MARGIN) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    const left = Number(bounds?.x);
    const top = Number(bounds?.y);
    const width = Number(bounds?.width);
    const height = Number(bounds?.height);
    if (
        !Number.isFinite(x) || !Number.isFinite(y) ||
        !Number.isFinite(left) || !Number.isFinite(top) ||
        !Number.isFinite(width) || !Number.isFinite(height) ||
        width <= margin * 2 || height <= 0
    ) {
        return null;
    }

    const right = left + width - 1;
    if (x > left + margin && x < right - margin) return null;
    return {
        x: Math.round(left + width / 2),
        y: Math.round(Math.min(top + height - 1, Math.max(top, y)))
    };
}

function navigationKeyMap(keys) {
    return new Map([
        [keys.W, 'forward'],
        [keys.S, 'backward'],
        [keys.A, 'left'],
        [keys.D, 'right'],
        [keys.I, 'mapUp'],
        [keys.K, 'mapDown'],
        [keys.J, 'mapLeft'],
        [keys.L, 'mapRight'],
        [keys.O, 'turnCounterclockwise'],
        [keys.P, 'turnClockwise']
    ]);
}

class NavigationInput {
    constructor({
        onMovementChange,
        onMouseDelta,
        onError,
        cursor,
        getBoundsForPoint
    } = {}) {
        this.onMovementChange = onMovementChange || (() => {});
        this.onMouseDelta = onMouseDelta || (() => {});
        this.onError = onError || (() => {});
        this.started = false;
        this.hook = null;
        this.keyMap = null;
        this.pressed = new Set();
        this.lastMousePosition = null;
        this.mouseBounds = null;
        this.cursorWarpTarget = null;
        this.cursor = cursor;
        this.getBoundsForPoint = getBoundsForPoint;
        this.handlers = null;
    }

    _movementState() {
        return {
            forward: this.pressed.has('forward'),
            backward: this.pressed.has('backward'),
            left: this.pressed.has('left'),
            right: this.pressed.has('right'),
            mapUp: this.pressed.has('mapUp'),
            mapDown: this.pressed.has('mapDown'),
            mapLeft: this.pressed.has('mapLeft'),
            mapRight: this.pressed.has('mapRight'),
            turnCounterclockwise: this.pressed.has('turnCounterclockwise'),
            turnClockwise: this.pressed.has('turnClockwise')
        };
    }

    _handleKey(event, pressed) {
        const direction = this.keyMap.get(event.keycode);
        if (!direction) return;
        const alreadyPressed = this.pressed.has(direction);
        if (pressed === alreadyPressed) return;

        if (pressed) {
            this.pressed.add(direction);
        } else {
            this.pressed.delete(direction);
        }
        this.onMovementChange(this._movementState());
    }

    _handleMouse(event) {
        const current = {x: event.x, y: event.y};
        if (
            this.cursorWarpTarget &&
            Math.abs(current.x - this.cursorWarpTarget.x) <= 2 &&
            Math.abs(current.y - this.cursorWarpTarget.y) <= 2
        ) {
            this.lastMousePosition = current;
            this.cursorWarpTarget = null;
            return;
        }

        const delta = mouseDeltaFromPositions(this.lastMousePosition, current);
        this.lastMousePosition = current;
        if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
            this.onMouseDelta(delta.dx, delta.dy);
        }

        if (!this.cursor || !this.getBoundsForPoint) return;
        if (!this.mouseBounds) this.mouseBounds = this.getBoundsForPoint(current);
        const target = cursorWrapTarget(current, this.mouseBounds);
        if (!target) return;

        this.cursorWarpTarget = target;
        this.lastMousePosition = target;
        if (!this.cursor.moveTo(target.x, target.y)) {
            this.cursorWarpTarget = null;
            this.lastMousePosition = current;
        }
    }

    start() {
        if (this.started) return;

        try {
            // Loaded lazily so unsupported platforms fail gracefully only when tracking starts.
            const {uIOhook, UiohookKey} = require('uiohook-napi');
            if (process.platform === 'win32' && this.cursor === undefined) {
                const WindowsCursor = require('./windows-cursor');
                const {screen} = require('electron');
                this.cursor = new WindowsCursor();
                this.getBoundsForPoint = point => screen.getDisplayNearestPoint(point).bounds;
            }
            this.hook = uIOhook;
            this.keyMap = navigationKeyMap(UiohookKey);
            this.handlers = {
                keydown: event => this._handleKey(event, true),
                keyup: event => this._handleKey(event, false),
                mousemove: event => this._handleMouse(event)
            };
            this.hook.on('keydown', this.handlers.keydown);
            this.hook.on('keyup', this.handlers.keyup);
            this.hook.on('mousemove', this.handlers.mousemove);
            this.hook.start();
            this.started = true;
        } catch (error) {
            this._detachHandlers();
            this.onError(error);
            throw error;
        }
    }

    _detachHandlers() {
        if (this.hook && this.handlers) {
            this.hook.removeListener('keydown', this.handlers.keydown);
            this.hook.removeListener('keyup', this.handlers.keyup);
            this.hook.removeListener('mousemove', this.handlers.mousemove);
        }
        this.handlers = null;
    }

    stop() {
        if (this.started && this.hook) {
            try {
                this.hook.stop();
            } catch (error) {
                this.onError(error);
            }
        }
        this._detachHandlers();
        this.started = false;
        this.hook = null;
        this.keyMap = null;
        this.pressed.clear();
        this.lastMousePosition = null;
        this.mouseBounds = null;
        this.cursorWarpTarget = null;
        this.onMovementChange(this._movementState());
    }
}

module.exports = {
    cursorWrapTarget,
    navigationKeyMap,
    NavigationInput,
    mouseDeltaFromPositions
};
