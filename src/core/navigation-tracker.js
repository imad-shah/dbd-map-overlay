'use strict';

const {ipcMain} = require('electron');
const {
    applyHeadingDelta,
    applyPoseCorrection,
    advancePose,
    constrainPoseToBoundary,
    normalizeHeading
} = require('./navigation-math');
const {NavigationInput} = require('./navigation-input');

const TRACKING_INTERVAL_MS = 1000 / 30;
const MAX_TICK_SECONDS = 0.1;
const DEFAULT_MOVE_SPEED = 0.07;
const DEFAULT_MOUSE_SENSITIVITY = 0.135;
const POSITION_CORRECTION_SPEED = 0.08;
const HEADING_CORRECTION_SPEED = 60;

class NavigationTracker {
    constructor(mainWindow, overlayWindow, settings, input = null, ipc = ipcMain) {
        this.mainWindow = mainWindow;
        this.overlayWindow = overlayWindow;
        this.settings = settings;
        this.currentMap = null;
        this.playableBoundary = null;
        this.mapVisible = false;
        this.resumeTrackingWhenShown = false;
        this.stateBeforeCalibration = null;
        this.state = this._emptyState();
        this.movement = this._emptyMovement();
        this.pendingMouseX = 0;
        this.ignoreMouseUntil = 0;
        this.lastTickAt = null;
        this.trackingTimer = null;
        this.handlingInputError = false;

        this.input = input || new NavigationInput({
            onMovementChange: movement => {
                this.movement = movement;
            },
            onMouseDelta: dx => {
                if (this.state.tracking && performance.now() >= this.ignoreMouseUntil) {
                    this.pendingMouseX += dx;
                }
            },
            onError: error => this._handleInputError(error)
        });

        ipc.handle('navigation:get-state', () => this.getState());
        ipc.handle('navigation:start-calibration', () => this.startCalibration());
        ipc.handle('navigation:cancel-calibration', () => this.cancelCalibration());
        ipc.handle('navigation:commit-calibration', (event, calibration) => (
            this.commitCalibration(calibration)
        ));
        ipc.handle('navigation:toggle-tracking', () => this.toggleTracking());
    }

    _emptyMovement() {
        return {
            forward: false,
            backward: false,
            left: false,
            right: false,
            mapUp: false,
            mapDown: false,
            mapLeft: false,
            mapRight: false,
            turnCounterclockwise: false,
            turnClockwise: false
        };
    }

    _emptyState() {
        return {
            status: 'idle',
            map: null,
            position: null,
            heading: null,
            tracking: false,
            inputError: null
        };
    }

    _cloneState(state = this.state) {
        return JSON.parse(JSON.stringify(state));
    }

    _settingNumber(key, fallback, min, max) {
        const value = Number(this.settings?.get(key));
        if (!Number.isFinite(value)) return fallback;
        return Math.min(max, Math.max(min, value));
    }

    _normalizeMap(map) {
        if (typeof map !== 'string' || map.length === 0 || map.length > 1024) return null;
        return map.replace(/\\/g, '/').replace(/^\/+/, '');
    }

    _isHens333Map(map) {
        return typeof map === 'string' && map.toLowerCase().startsWith('hens333/');
    }

    _broadcast(includeMainWindow = true) {
        const state = this.getState();
        this.overlayWindow.send('navigation-state', state);
        if (includeMainWindow) this.mainWindow.send('navigation-state', state);
    }

    getState() {
        return this._cloneState();
    }

    _startInputTracking() {
        this._stopInputTracking();
        this.state.inputError = null;
        this.movement = this._emptyMovement();
        this.pendingMouseX = 0;
        this.lastTickAt = performance.now();
        this.ignoreMouseUntil = this.lastTickAt + 500;

        try {
            this.input.start();
        } catch (error) {
            this.state.tracking = false;
            this.state.inputError = error.message || String(error);
            return false;
        }

        this.state.tracking = true;
        this.trackingTimer = setInterval(() => this._tick(), TRACKING_INTERVAL_MS);
        return true;
    }

    _stopInputTracking() {
        if (this.trackingTimer) {
            clearInterval(this.trackingTimer);
            this.trackingTimer = null;
        }
        this.state.tracking = false;
        this.lastTickAt = null;
        this.pendingMouseX = 0;
        this.ignoreMouseUntil = 0;
        this.movement = this._emptyMovement();
        this.input.stop();
    }

    _handleInputError(error) {
        if (this.handlingInputError) return;
        this.handlingInputError = true;
        try {
            this.state.tracking = false;
            this.state.inputError = error?.message || String(error);
            if (this.trackingTimer) {
                clearInterval(this.trackingTimer);
                this.trackingTimer = null;
            }
            this._broadcast();
            this.mainWindow.sendUpdate(`Navigation input stopped: ${this.state.inputError}`);
        } finally {
            this.handlingInputError = false;
        }
    }

    _tick() {
        if (!this.state.tracking || !this.state.position) return;
        const now = performance.now();
        const elapsed = Math.min(MAX_TICK_SECONDS, Math.max(0, (now - this.lastTickAt) / 1000));
        this.lastTickAt = now;

        const mouseDeltaX = this.pendingMouseX;
        this.pendingMouseX = 0;
        const hasMovement = Object.values(this.movement).some(Boolean);
        if (!hasMovement && mouseDeltaX === 0) return;

        const heading = applyHeadingDelta(
            this.state.heading,
            mouseDeltaX,
            this._settingNumber('navigationMouseSensitivity', DEFAULT_MOUSE_SENSITIVITY, 0, 5)
        );
        const correctedPose = applyPoseCorrection(
            {...this.state.position, heading},
            this.movement,
            elapsed,
            POSITION_CORRECTION_SPEED,
            HEADING_CORRECTION_SPEED
        );
        const advancedPose = advancePose(
            correctedPose,
            this.movement,
            elapsed,
            this._settingNumber('navigationMoveSpeed', DEFAULT_MOVE_SPEED, 0, 0.25)
        );
        const pose = constrainPoseToBoundary(advancedPose, this.playableBoundary);
        this.state.heading = pose.heading;
        this.state.position = {x: pose.x, y: pose.y};
        this._broadcast(false);
    }

    setMap(map) {
        const normalizedMap = this._normalizeMap(map);
        if (!normalizedMap) {
            let shouldResume = this.resumeTrackingWhenShown || this.state.tracking;
            if (this.state.status === 'calibrating') {
                const previousState = this.stateBeforeCalibration || {
                    status: 'awaiting-calibration',
                    map: this.currentMap,
                    position: null,
                    heading: null,
                    tracking: false,
                    inputError: null
                };
                shouldResume = previousState.tracking;
                this.state = previousState;
                this.state.tracking = false;
                this.stateBeforeCalibration = null;
            }
            this._stopInputTracking();
            this.overlayWindow.endInteraction();
            this.mapVisible = false;
            this.resumeTrackingWhenShown = shouldResume;
            this._broadcast();
            return;
        }
        if (!this._isHens333Map(normalizedMap)) {
            this.reset();
            return;
        }
        if (normalizedMap === this.currentMap) {
            if (this.mapVisible) return;
            this.mapVisible = true;
            const shouldResume = this.resumeTrackingWhenShown;
            this.resumeTrackingWhenShown = false;
            if (shouldResume && this.state.status === 'calibrated') {
                this._startInputTracking();
            }
            this._broadcast();
            return;
        }

        this._stopInputTracking();
        this.overlayWindow.endInteraction();
        this.currentMap = normalizedMap;
        this.playableBoundary = null;
        this.mapVisible = true;
        this.resumeTrackingWhenShown = false;
        this.stateBeforeCalibration = null;
        this.state = {
            status: 'awaiting-calibration',
            map: normalizedMap,
            position: null,
            heading: null,
            tracking: false,
            inputError: null
        };
        this._broadcast();
    }

    canStartCalibration() {
        return this.mapVisible && this._isHens333Map(this.currentMap);
    }

    supportsMap(map) {
        return this._isHens333Map(this._normalizeMap(map));
    }

    hasBoundaryForMap(map) {
        return this.playableBoundary !== null && this._normalizeMap(map) === this.currentMap;
    }

    setPlayableBoundary(map, boundary) {
        if (this._normalizeMap(map) !== this.currentMap || !boundary) return false;
        this.playableBoundary = boundary;
        if (this.state.position) {
            const pose = constrainPoseToBoundary(
                {...this.state.position, heading: this.state.heading},
                this.playableBoundary
            );
            this.state.position = {x: pose.x, y: pose.y};
            this._broadcast();
        }
        return true;
    }

    startCalibration() {
        if (!this.canStartCalibration()) {
            this.mainWindow.sendUpdate('Detect or select a Hens333 map before placing the navigation pin.');
            return {ok: false, reason: 'no-hens333-map'};
        }
        if (this.state.status === 'calibrating') {
            return {ok: true, alreadyCalibrating: true};
        }
        if (!this.overlayWindow.beginInteraction()) {
            return {ok: false, reason: 'overlay-unavailable'};
        }

        this.stateBeforeCalibration = this._cloneState();
        this._stopInputTracking();
        this.state.status = 'calibrating';
        this.state.inputError = null;
        this._broadcast();
        this.overlayWindow.send('navigation-calibration-start', this.getState());
        this.mainWindow.sendUpdate('Place your pin, then click toward the direction you are facing.');
        return {ok: true};
    }

    commitCalibration(calibration) {
        if (this.state.status !== 'calibrating' || !this._isHens333Map(this.currentMap)) {
            return {ok: false, reason: 'not-calibrating'};
        }

        const x = Number(calibration?.x);
        const y = Number(calibration?.y);
        const heading = Number(calibration?.heading);
        if (
            !Number.isFinite(x) || x < 0 || x > 1 ||
            !Number.isFinite(y) || y < 0 || y > 1 ||
            !Number.isFinite(heading)
        ) {
            return {ok: false, reason: 'invalid-calibration'};
        }

        const pose = constrainPoseToBoundary({x, y, heading}, this.playableBoundary);
        this.state = {
            status: 'calibrated',
            map: this.currentMap,
            position: {x: pose.x, y: pose.y},
            heading: normalizeHeading(pose.heading),
            tracking: false,
            inputError: null
        };
        this.stateBeforeCalibration = null;
        const trackingStarted = this._startInputTracking();
        this.overlayWindow.endInteraction();
        this._broadcast();
        this.mainWindow.sendUpdate(trackingStarted
            ? 'Navigation tracking started. Use Ctrl+Shift+Space to pause or resume.'
            : `Calibration saved, but global input failed: ${this.state.inputError}`
        );
        return {ok: true, trackingStarted, state: this.getState()};
    }

    cancelCalibration() {
        if (this.state.status !== 'calibrating') return {ok: true};
        const previousState = this.stateBeforeCalibration || {
            status: 'awaiting-calibration',
            map: this.currentMap,
            position: null,
            heading: null,
            tracking: false,
            inputError: null
        };
        const shouldResume = previousState.tracking;
        this.state = previousState;
        this.state.tracking = false;
        this.stateBeforeCalibration = null;
        if (shouldResume) this._startInputTracking();
        this.overlayWindow.endInteraction();
        this._broadcast();
        this.mainWindow.sendUpdate('Navigation calibration canceled.');
        return {ok: true};
    }

    toggleTracking() {
        if (!this.mapVisible) {
            this.mainWindow.sendUpdate('Show the map before starting navigation tracking.');
            return {ok: false, reason: 'map-hidden'};
        }
        if (this.state.status !== 'calibrated' || !this.state.position) {
            this.mainWindow.sendUpdate('Calibrate a Hens333 map before starting navigation tracking.');
            return {ok: false, reason: 'not-calibrated'};
        }

        if (this.state.tracking) {
            this._stopInputTracking();
            this._broadcast();
            this.mainWindow.sendUpdate('Navigation tracking paused.');
            return {ok: true, tracking: false, state: this.getState()};
        }

        const started = this._startInputTracking();
        this._broadcast();
        this.mainWindow.sendUpdate(started
            ? 'Navigation tracking resumed.'
            : `Navigation input failed: ${this.state.inputError}`
        );
        return {ok: started, tracking: started, state: this.getState()};
    }

    reset() {
        const wasActive = this.state.status !== 'idle' || this.currentMap !== null;
        this._stopInputTracking();
        this.overlayWindow.endInteraction();
        this.currentMap = null;
        this.playableBoundary = null;
        this.mapVisible = false;
        this.resumeTrackingWhenShown = false;
        this.stateBeforeCalibration = null;
        this.state = this._emptyState();
        if (wasActive) this._broadcast();
    }

    destroy() {
        this._stopInputTracking();
    }
}

module.exports = NavigationTracker;
