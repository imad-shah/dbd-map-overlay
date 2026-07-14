'use strict';

const {ipcRenderer} = require('electron');
const {headingFromPoints} = require('../core/navigation-math');

const body = document.body;
const mapLayer = document.getElementById('mapLayer');
const mainImg = document.getElementById('mainImg');
const playerPin = document.getElementById('playerPin');
const directionGuide = document.getElementById('directionGuide');
const calibrationHint = document.getElementById('calibrationHint');

let url = null;
let currentRotation = 0;
let renderedRotation = 0;
let currentDraggable = false;
let navigationState = null;
let calibrationStage = null;
let draftPosition = null;

function setHint(message) {
    calibrationHint.textContent = message;
}

function setPin(position, heading) {
    if (!position) {
        playerPin.style.display = 'none';
        return;
    }
    playerPin.style.display = 'block';
    playerPin.style.left = `${position.x * 100}%`;
    playerPin.style.top = `${position.y * 100}%`;
    playerPin.style.setProperty('--heading', `${Number(heading) || 0}deg`);
}

function applyMapTransform() {
    renderedRotation = currentRotation;
    mapLayer.style.transform = `rotate(${renderedRotation}deg)`;
    body.classList.toggle('navigation-tracking', Boolean(navigationState?.tracking));
}

function renderNavigationState(state) {
    navigationState = state;
    if (calibrationStage !== null && state?.status !== 'calibrating') {
        finishCalibrationUi();
    }
    if (calibrationStage !== null && draftPosition) return;
    applyMapTransform();
    setPin(state?.position || null, state?.heading || 0);
}

function pointOnUnrotatedMap(clientX, clientY) {
    const width = mapLayer.offsetWidth;
    const height = mapLayer.offsetHeight;
    if (width <= 0 || height <= 0) return null;

    const rect = mapLayer.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const radians = -renderedRotation * Math.PI / 180;
    const localX = Math.cos(radians) * dx - Math.sin(radians) * dy + width / 2;
    const localY = Math.sin(radians) * dx + Math.cos(radians) * dy + height / 2;

    if (localX < 0 || localX > width || localY < 0 || localY > height) return null;
    return {
        x: localX / width,
        y: localY / height,
        pixelX: localX,
        pixelY: localY
    };
}

function updateDirectionGuide(clientX, clientY) {
    if (!draftPosition || calibrationStage !== 'direction') {
        directionGuide.style.display = 'none';
        return;
    }
    const pinRect = playerPin.getBoundingClientRect();
    const startX = pinRect.left + pinRect.width / 2;
    const startY = pinRect.top + pinRect.height / 2;
    const dx = clientX - startX;
    const dy = clientY - startY;
    directionGuide.style.display = 'block';
    directionGuide.style.left = `${startX}px`;
    directionGuide.style.top = `${startY}px`;
    directionGuide.style.width = `${Math.hypot(dx, dy)}px`;
    directionGuide.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

function finishCalibrationUi() {
    calibrationStage = null;
    draftPosition = null;
    body.classList.remove('calibrating');
    directionGuide.style.display = 'none';
    body.style.webkitAppRegion = currentDraggable ? 'drag' : 'no-drag';
}

function startCalibrationUi() {
    calibrationStage = 'position';
    draftPosition = null;
    body.classList.add('calibrating');
    body.style.webkitAppRegion = 'no-drag';
    directionGuide.style.display = 'none';
    setPin(null, 0);
    setHint('Click your approximate position. Press Esc to cancel.');
}

mapLayer.addEventListener('click', async event => {
    if (calibrationStage === null || event.button !== 0) return;
    const point = pointOnUnrotatedMap(event.clientX, event.clientY);
    if (!point) return;

    if (calibrationStage === 'position') {
        draftPosition = point;
        calibrationStage = 'direction';
        setPin(point, navigationState?.heading || 0);
        setHint('Click toward the direction you are facing. Right-click to replace the pin.');
        return;
    }

    const heading = headingFromPoints(
        {x: draftPosition.pixelX, y: draftPosition.pixelY},
        {x: point.pixelX, y: point.pixelY}
    );
    if (heading === null) {
        setHint('Choose a direction point farther away from the pin.');
        return;
    }

    const result = await ipcRenderer.invoke('navigation:commit-calibration', {
        x: draftPosition.x,
        y: draftPosition.y,
        heading
    });
    if (!result?.ok) {
        setHint('Could not save calibration. Try again or press Esc.');
        return;
    }
    finishCalibrationUi();
    renderNavigationState(result.state);
});

mapLayer.addEventListener('contextmenu', event => {
    if (calibrationStage === null) return;
    event.preventDefault();
    calibrationStage = 'position';
    draftPosition = null;
    directionGuide.style.display = 'none';
    setPin(null, 0);
    setHint('Click your approximate position. Press Esc to cancel.');
});

document.addEventListener('mousemove', event => {
    updateDirectionGuide(event.clientX, event.clientY);
});

document.addEventListener('keydown', async event => {
    if (event.key !== 'Escape' || calibrationStage === null) return;
    await ipcRenderer.invoke('navigation:cancel-calibration');
    finishCalibrationUi();
    renderNavigationState(navigationState);
});

ipcRenderer.on('map-change', (event, img, size, opacity, draggable, rotation) => {
    if (url !== null) URL.revokeObjectURL(url);
    const imgData = Buffer.from(img, 'base64');
    url = URL.createObjectURL(new Blob([imgData]));
    currentRotation = Number(rotation) || 0;
    currentDraggable = Boolean(draggable);
    mainImg.src = url;
    mainImg.style.width = `${size}px`;
    mainImg.style.opacity = opacity;
    applyMapTransform();
    if (calibrationStage === null) {
        body.style.webkitAppRegion = currentDraggable ? 'drag' : 'no-drag';
        renderNavigationState(navigationState);
    }
});

ipcRenderer.on('map-hide', () => {
    mainImg.style.width = '0px';
    setPin(null, 0);
    finishCalibrationUi();
});

ipcRenderer.on('navigation-state', (event, state) => {
    renderNavigationState(state);
});

ipcRenderer.on('navigation-calibration-start', () => {
    startCalibrationUi();
});

mainImg.addEventListener('load', applyMapTransform);
ipcRenderer.invoke('navigation:get-state').then(renderNavigationState);
