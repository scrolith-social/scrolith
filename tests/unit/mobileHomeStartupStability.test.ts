import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('mobile home evaluates its viewport redirect after the hook sequence', () => {
  const source = read('src/mobile/home/MobileHome.tsx');
  const redirectGuard = source.indexOf('if (!isMobileViewport && !allowDesktopOverride)');

  assert.ok(redirectGuard > source.indexOf('const layout = useMemo('));
  assert.ok(redirectGuard > source.lastIndexOf('useEffect(', redirectGuard));
  assert.match(source, /const ScrollFeed = React\.lazy\(\(\) => import\('\.\.\/\.\.\/features\/scroll\/ScrollFeed'\)\)/);
});

test('optional member-home enhancements are isolated from the core shell boundary', () => {
  const source = read('src/App.tsx');

  assert.match(source, /class OptionalFeatureBoundary extends React\.Component/);
  assert.match(source, /const MemberHomeDeveloperWidgetSlot = \(\) =>/);
  assert.match(source, /<OptionalFeatureBoundary>[\s\S]*<MemberHomeDeveloperWidget \/>[\s\S]*<\/OptionalFeatureBoundary>/);
});
