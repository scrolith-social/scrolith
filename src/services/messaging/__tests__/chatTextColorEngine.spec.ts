import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appearanceToBackgroundStyle,
  buildChatPalette,
  contrastRatio,
  estimateBackgroundLuminance,
  parseCssColor,
  relativeLuminance
} from '../chatTextColorEngine';

describe('chatTextColorEngine', () => {
  it('parses hex and rgb colors', () => {
    assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.equal(parseCssColor('#0f172a')?.r, 15);
    assert.deepEqual(parseCssColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  });

  it('computes relative luminance and contrast', () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    assert.ok(white > 0.9);
    assert.ok(black < 0.05);
    assert.ok(contrastRatio(white, black) > 20);
  });

  it('estimates dark solid backgrounds as dark', () => {
    assert.ok(estimateBackgroundLuminance({ kind: 'solid', color: '#0f172a' }) < 0.2);
    assert.ok(estimateBackgroundLuminance({ kind: 'none' }) > 0.9);
  });

  it('builds light palette for light backgrounds with WCAG-oriented contrast', () => {
    const palette = buildChatPalette({ kind: 'solid', color: '#ffffff' });
    assert.equal(palette.mode, 'light');
    assert.match(palette.text, /^#0f172a$/i);
    const bgL = relativeLuminance(255, 255, 255);
    const text = parseCssColor(palette.text)!;
    const textL = relativeLuminance(text.r, text.g, text.b);
    assert.ok(contrastRatio(bgL, textL) >= 4.5);
  });

  it('builds dark palette for dark backgrounds', () => {
    const palette = buildChatPalette({ kind: 'solid', color: '#0f172a' });
    assert.equal(palette.mode, 'dark');
    assert.match(palette.bubbleIncomingText, /#f/i);
    assert.ok(palette.pinBannerText);
  });

  it('defaults photo/wallpaper to dark-safe text', () => {
    const palette = buildChatPalette({ kind: 'photo', imageUrl: 'https://example.com/a.jpg' });
    assert.equal(palette.mode, 'dark');
  });

  it('maps appearance to background styles', () => {
    assert.equal(appearanceToBackgroundStyle({ kind: 'solid', color: '#abc' }).backgroundColor, '#abc');
    const gradient = appearanceToBackgroundStyle({
      kind: 'gradient',
      color: '#111',
      colorEnd: '#222'
    });
    assert.match(String(gradient.backgroundImage || ''), /linear-gradient/);
    const photo = appearanceToBackgroundStyle({
      kind: 'photo',
      imageUrl: 'https://cdn.example.com/x.jpg',
      blurPx: 8
    });
    assert.match(String(photo.backgroundImage || ''), /url\(/);
    assert.match(String(photo.filter || ''), /blur\(8px\)/);
  });
});
