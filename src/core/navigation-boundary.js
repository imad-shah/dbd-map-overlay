'use strict';

const sharp = require('sharp');

const BOUNDARY_RESOLUTION = 128;
const COMPONENT_SIZE_RATIO = 0.025;
const OPEN_RADIUS = 2;
const CLOSE_RADIUS = 2;
const MERGE_GAP_RATIO = 0.06;

function isPlayableFill(red, green, blue) {
    return red >= 70 && green >= 70 && blue >= 110 && blue - red >= 25;
}

function connectedComponents(mask, width, height) {
    const seen = new Uint8Array(mask.length);
    const components = [];

    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        const component = [];
        const queue = [start];
        seen[start] = 1;

        for (let offset = 0; offset < queue.length; offset++) {
            const index = queue[offset];
            const x = index % width;
            const y = Math.floor(index / width);
            component.push(index);
            const neighbors = [
                x > 0 ? index - 1 : -1,
                x + 1 < width ? index + 1 : -1,
                y > 0 ? index - width : -1,
                y + 1 < height ? index + width : -1
            ];

            for (const neighbor of neighbors) {
                if (neighbor >= 0 && mask[neighbor] && !seen[neighbor]) {
                    seen[neighbor] = 1;
                    queue.push(neighbor);
                }
            }
        }
        components.push(component);
    }

    return components.sort((a, b) => b.length - a.length);
}

function dilate(mask, width, height, radius) {
    const result = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let found = false;
            for (let dy = -radius; dy <= radius && !found; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const sampleX = x + dx;
                    const sampleY = y + dy;
                    if (
                        sampleX >= 0 && sampleX < width &&
                        sampleY >= 0 && sampleY < height &&
                        mask[sampleY * width + sampleX]
                    ) {
                        found = true;
                        break;
                    }
                }
            }
            result[y * width + x] = found ? 1 : 0;
        }
    }
    return result;
}

function erode(mask, width, height, radius) {
    const result = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let filled = true;
            for (let dy = -radius; dy <= radius && filled; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const sampleX = x + dx;
                    const sampleY = y + dy;
                    if (
                        sampleX < 0 || sampleX >= width ||
                        sampleY < 0 || sampleY >= height ||
                        !mask[sampleY * width + sampleX]
                    ) {
                        filled = false;
                        break;
                    }
                }
            }
            result[y * width + x] = filled ? 1 : 0;
        }
    }
    return result;
}

function fillEnclosedHoles(mask, width, height) {
    const outside = new Uint8Array(mask.length);
    const queue = [];
    const addOutside = index => {
        if (!mask[index] && !outside[index]) {
            outside[index] = 1;
            queue.push(index);
        }
    };

    for (let x = 0; x < width; x++) {
        addOutside(x);
        addOutside((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        addOutside(y * width);
        addOutside(y * width + width - 1);
    }

    for (let offset = 0; offset < queue.length; offset++) {
        const index = queue[offset];
        const x = index % width;
        const y = Math.floor(index / width);
        for (const neighbor of [
            x > 0 ? index - 1 : -1,
            x + 1 < width ? index + 1 : -1,
            y > 0 ? index - width : -1,
            y + 1 < height ? index + width : -1
        ]) {
            if (neighbor >= 0 && !mask[neighbor] && !outside[neighbor]) {
                outside[neighbor] = 1;
                queue.push(neighbor);
            }
        }
    }

    const result = new Uint8Array(mask.length);
    for (let index = 0; index < result.length; index++) {
        result[index] = mask[index] || !outside[index] ? 1 : 0;
    }
    return result;
}

function intervalsForRow(mask, width, y) {
    const intervals = [];
    let start = null;
    for (let x = 0; x < width; x++) {
        const filled = Boolean(mask[y * width + x]);
        if (filled && start === null) start = x;
        if (start !== null && (!filled || x === width - 1)) {
            const end = filled && x === width - 1 ? x : x - 1;
            intervals.push({min: start / (width - 1), max: end / (width - 1)});
            start = null;
        }
    }
    const merged = [];
    for (const interval of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && interval.min - previous.max <= MERGE_GAP_RATIO) {
            previous.max = interval.max;
        } else {
            merged.push(interval);
        }
    }
    return merged;
}

function buildPlayableBoundary(rgb, width, height, channels = 3) {
    if (!rgb || width < 2 || height < 2 || channels < 3) return null;
    const colorMask = new Uint8Array(width * height);
    for (let index = 0; index < colorMask.length; index++) {
        const offset = index * channels;
        colorMask[index] = isPlayableFill(
            rgb[offset],
            rgb[offset + 1],
            rgb[offset + 2]
        ) ? 1 : 0;
    }

    const components = connectedComponents(colorMask, width, height);
    if (components.length === 0) return null;
    const minimumSize = Math.max(4, Math.ceil(components[0].length * COMPONENT_SIZE_RATIO));
    const selected = new Uint8Array(colorMask.length);
    for (const component of components) {
        if (component.length < minimumSize) break;
        for (const index of component) selected[index] = 1;
    }

    const opened = dilate(erode(selected, width, height, OPEN_RADIUS), width, height, OPEN_RADIUS);
    const closed = erode(dilate(opened, width, height, CLOSE_RADIUS), width, height, CLOSE_RADIUS);
    const silhouette = fillEnclosedHoles(closed, width, height);
    const rows = Array.from({length: height}, (_, y) => intervalsForRow(silhouette, width, y));
    const firstRow = rows.findIndex(intervals => intervals.length > 0);
    let lastRow = -1;
    for (let y = height - 1; y >= 0; y--) {
        if (rows[y].length > 0) {
            lastRow = y;
            break;
        }
    }
    if (firstRow < 0 || lastRow < firstRow) return null;

    return {
        rows,
        minY: firstRow / (height - 1),
        maxY: lastRow / (height - 1)
    };
}

async function extractPlayableBoundary(imageBuffer) {
    const {data, info} = await sharp(imageBuffer)
        .resize(BOUNDARY_RESOLUTION, BOUNDARY_RESOLUTION, {fit: 'fill'})
        .removeAlpha()
        .raw()
        .toBuffer({resolveWithObject: true});
    return buildPlayableBoundary(data, info.width, info.height, info.channels);
}

module.exports = {
    buildPlayableBoundary,
    extractPlayableBoundary,
    isPlayableFill
};
