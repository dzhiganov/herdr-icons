/**
 * Pixel grids to Unicode braille. One braille cell is 2 pixels wide and 4 tall,
 * so a 6×4 grid becomes 3 characters. Rows use `#` for a lit pixel, anything
 * else for an unlit one.
 */
export type Grid = readonly string[];

export const GRID_HEIGHT = 4;

// Bit for the dot at (x, y) inside a cell: Unicode braille dot numbering.
const DOT: readonly (readonly number[])[] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export function gridWidth(grid: Grid): number {
  return Math.max(0, ...grid.map((r) => r.length));
}

/** Encode a grid as braille. Width is rounded up to an even number of pixels. */
export function toBraille(grid: Grid): string {
  if (grid.length !== GRID_HEIGHT) throw new Error(`grid must have ${GRID_HEIGHT} rows, got ${grid.length}`);
  const cells = Math.ceil(gridWidth(grid) / 2);
  let out = '';
  for (let cell = 0; cell < cells; cell++) {
    let bits = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let dx = 0; dx < 2; dx++) {
        if (grid[y]![cell * 2 + dx] === '#') bits |= DOT[y]![dx]!;
      }
    }
    out += String.fromCodePoint(0x2800 + bits);
  }
  return out;
}

/** Blank grid of the given width. */
export function blank(width: number): string[] {
  return Array.from({ length: GRID_HEIGHT }, () => '.'.repeat(width));
}

/** `grid` with the pixel at (x, y) lit. Out-of-range pixels are ignored. */
export function plot(grid: Grid, x: number, y: number): string[] {
  return grid.map((row, ry) =>
    ry === y && x >= 0 && x < row.length ? `${row.slice(0, x)}#${row.slice(x + 1)}` : row,
  );
}
