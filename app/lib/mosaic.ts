// The app's mosaic (transat-app src/screens/services/photos/photos.layout.ts), for the web gallery: justified rows,
// now and then a large tile beside two stacked ones, or a wide photo across the full width. Every decision depends
// only on the photo ids and shapes, and only on the photos at or after the current one, so appending a page never
// changes the blocks above it.

export type MosaicPhoto = { id: string; width: number; height: number };

export type MosaicTile<P extends MosaicPhoto> = { photo: P; index: number; x: number; y: number; width: number; height: number };

export type MosaicBlock<P extends MosaicPhoto> = { key: string; height: number; tiles: MosaicTile<P>[] };

/** Columns of the app's standard grid for a width: the mosaic's rows are a little taller than those tiles. */
const columnsFor = (width: number) => {
    if (width >= 1100) return 7;
    if (width >= 800) return 5;
    if (width >= 560) return 4;
    return 3;
};

const tileSizeFor = (width: number, columns: number, gap: number) => Math.floor((width - gap * (columns - 1)) / columns);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const hasDimensions = (p: MosaicPhoto) => p.width > 0 && p.height > 0;

/** Layout aspect ratio: missing sizes count as square, extreme panoramas and strips are tamed. */
const aspectOf = (p: MosaicPhoto) => (hasDimensions(p) ? clamp(p.width / p.height, 0.6, 2) : 1);

/** FNV-1a: a stable pseudo-random number per photo id, so the mosaic never reshuffles. */
const hashId = (id: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};

type Placed<P extends MosaicPhoto> = { photo: P; index: number };
type Block<P extends MosaicPhoto> = { height: number; tiles: MosaicTile<P>[] };

const toBlock = <P extends MosaicPhoto>(photos: Placed<P>[], widths: number[], height: number, gap: number): Block<P> => {
    let x = 0;
    return {
        height,
        tiles: photos.map((p, i) => {
            const tile = {...p, x, y: 0, width: widths[i], height};
            x += widths[i] + gap;
            return tile;
        }),
    };
};

/**
 * One row side by side. Natural height fills the width exactly; when that would crop too much the row is stretched
 * within bounds, or left short rather than blowing a lone photo up to full width.
 */
const justifiedRow = <P extends MosaicPhoto>(photos: Placed<P>[], width: number, gap: number, target: number, provisional: boolean): Block<P> => {
    const ratios = photos.map((p) => aspectOf(p.photo));
    const sum = ratios.reduce((a, b) => a + b, 0);
    const room = width - gap * (photos.length - 1);
    const natural = room / sum;

    if (provisional) {
        // More photos may follow: keep the row short so it never has to be redrawn at full width.
        const scale = Math.min(1, room / (sum * target));
        return toBlock(photos, ratios.map((r) => Math.floor(r * target * scale)), Math.round(target * scale), gap);
    }
    if (natural > target * 1.4) {
        const height = Math.round(target * 1.4);
        return toBlock(photos, ratios.map((r) => Math.floor(r * height)), height, gap);
    }
    const height = Math.round(Math.max(natural, target * 0.75));
    const widths = ratios.map((r) => Math.floor((room * r) / sum));
    widths[widths.length - 1] += room - widths.reduce((a, b) => a + b, 0);
    return toBlock(photos, widths, height, gap);
};

/** One photo across the full width. */
const heroBlock = <P extends MosaicPhoto>(p: Placed<P>, width: number): Block<P> => {
    const height = Math.round(width / clamp(aspectOf(p.photo), 1.35, 2));
    return {height, tiles: [{...p, x: 0, y: 0, width, height}]};
};

/** A large tile (2/3 of the width) next to two stacked ones; reading order stays big, then the two small ones. */
const featureBlock = <P extends MosaicPhoto>(trio: Placed<P>[], width: number, gap: number): Block<P> => {
    const bigWidth = Math.round(((width - gap) * 2) / 3);
    const smallWidth = width - gap - bigWidth;
    const wanted = Math.round(bigWidth * clamp(1 / aspectOf(trio[0].photo), 0.85, 1.2));
    const smallHeight = Math.floor((wanted - gap) / 2);
    const height = smallHeight * 2 + gap;
    return {
        height,
        tiles: [
            {...trio[0], x: 0, y: 0, width: bigWidth, height},
            {...trio[1], x: bigWidth + gap, y: 0, width: smallWidth, height: smallHeight},
            {...trio[2], x: bigWidth + gap, y: smallHeight + gap, width: smallWidth, height: smallHeight},
        ],
    };
};

/**
 * Wide screens: the app's large blocks span the whole width and would stand taller than the window. There, the
 * large photo is two rows high, beside two justified rows of the photos that follow.
 */
const WIDE = 900;

const fillRow = <P extends MosaicPhoto>(group: Placed<P>[], from: number, room: number, height: number, gap: number) => {
    let k = 0;
    let sum = 0;
    while (from + k < group.length) {
        const next = sum + aspectOf(group[from + k].photo);
        const over = next * height + gap * k - room;
        if (over >= 0) {
            // Take this photo only if it lands closer to the room than stopping before it.
            const under = room - (sum * height + gap * Math.max(0, k - 1));
            if (k === 0 || over < under) k++;
            break;
        }
        sum = next;
        k++;
    }
    return k;
};

const wideFeatureBlock = <P extends MosaicPhoto>(group: Placed<P>[], i: number, width: number, gap: number, target: number) => {
    const rowHeight = target;
    const height = rowHeight * 2 + gap;
    const bigWidth = Math.round(height * clamp(aspectOf(group[i].photo), 0.75, 1.5));
    const room = width - bigWidth - gap;
    const tiles: MosaicTile<P>[] = [{...group[i], x: 0, y: 0, width: bigWidth, height}];
    let j = i + 1;
    for (let r = 0; r < 2; r++) {
        const k = fillRow(group, j, room, rowHeight, gap);
        if (k === 0) return null;
        const row = group.slice(j, j + k);
        const ratios = row.map((p) => aspectOf(p.photo));
        const sum = ratios.reduce((a, b) => a + b, 0);
        const inner = room - gap * (k - 1);
        const widths = ratios.map((v) => Math.floor((inner * v) / sum));
        widths[k - 1] += inner - widths.reduce((a, b) => a + b, 0);
        let x = bigWidth + gap;
        row.forEach((p, c) => {
            tiles.push({...p, x, y: r * (rowHeight + gap), width: widths[c], height: rowHeight});
            x += widths[c] + gap;
        });
        j += k;
    }
    return {block: {height, tiles}, used: j - i};
};

/** Photos since the last large block before another one may appear. */
const BIG_SPACING = 5;

/**
 * Lays the photos out as mosaic blocks for a container `width` pixels wide. `complete` says no photo follows, which
 * is when the last row may be stretched or merged.
 */
export function mosaicBlocks<P extends MosaicPhoto>(photos: P[], width: number, gap: number, complete: boolean): MosaicBlock<P>[] {
    const group = photos.map((photo, index) => ({photo, index}));
    const target = Math.round(tileSizeFor(width, columnsFor(width), gap) * 1.2);
    const maxPerRow = Math.max(3, Math.round(width / target) + 1);
    const heightFor = (count: number, sum: number) => (width - gap * (count - 1)) / sum;
    const blocks: MosaicBlock<P>[] = [];
    const push = (b: Block<P>) => blocks.push({...b, key: b.tiles[0].photo.id});
    const n = group.length;
    let i = 0;
    let sinceBig = 0;

    while (i < n) {
        const remaining = n - i;
        const photo = group[i].photo;
        const hash = hashId(photo.id);
        const roomForBig = sinceBig >= BIG_SPACING;

        // The mosaic never ends with a single orphan photo: blocks that would leave one are not chosen.
        const feature = roomForBig && remaining >= 3 && remaining !== 4 && hash % (aspectOf(photo) < 0.9 ? 4 : 6) === 0;
        const hero = !feature && roomForBig && remaining !== 2 && hasDimensions(photo) && aspectOf(photo) >= 1.35 && (hash >>> 4) % 9 === 0;

        if (width >= WIDE) {
            // Enough photos after it, and never a lone photo left at the very end.
            const wide = (feature || hero) && remaining >= 8 ? wideFeatureBlock(group, i, width, gap, target) : null;
            if (wide && !(complete && remaining - wide.used === 1)) {
                push(wide.block);
                i += wide.used;
                sinceBig = 0;
                continue;
            }
        } else if (feature) {
            push(featureBlock(group.slice(i, i + 3), width, gap));
            i += 3;
            sinceBig = 0;
            continue;
        }
        if (hero && width < WIDE) {
            push(heroBlock(group[i], width));
            i += 1;
            sinceBig = 0;
            continue;
        }

        let used = 0;
        let sum = 0;
        let prevSum = 0;
        let prevHeight = Number.POSITIVE_INFINITY;
        let height = 0;
        const limit = Math.min(maxPerRow, remaining);
        while (used < limit) {
            prevSum = sum;
            prevHeight = used > 0 ? heightFor(used, sum) : Number.POSITIVE_INFINITY;
            sum += aspectOf(group[i + used].photo);
            used++;
            height = heightFor(used, sum);
            if (height <= target) break;
        }
        // Too squat with this many photos: one fewer gives the closer row.
        if (used > 1 && height < target * 0.8 && prevHeight <= target * 1.5) {
            used--;
            sum = prevSum;
        }
        if (complete && n - (i + used) === 1) used++;

        const end = i + used;
        push(justifiedRow(group.slice(i, end), width, gap, target, !complete && end >= n));
        i = end;
        sinceBig += used;
    }
    return blocks;
}
