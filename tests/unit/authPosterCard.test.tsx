import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthPosterCard from '../../src/components/auth/AuthPosterCard';

test('login poster renders an accessible professional-workspace card', () => {
  const markup = renderToStaticMarkup(<AuthPosterCard mode="login" />);

  assert.match(markup, /<figure[^>]+aria-label="Scrolith professional workspace"/);
  assert.match(markup, /alt="Scrolith connects people, work, payments, messaging, and community in one professional platform\."/);
  assert.match(markup, /loading="lazy"/);
  assert.match(markup, /Work · Connect · Grow/);
});

test('signup poster preserves the signup-specific accessible label and caption', () => {
  const markup = renderToStaticMarkup(<AuthPosterCard mode="signup" />);

  assert.match(markup, /<figure[^>]+aria-label="Scrolith community and professional growth"/);
  assert.match(markup, /Build · Connect · Grow/);
});
