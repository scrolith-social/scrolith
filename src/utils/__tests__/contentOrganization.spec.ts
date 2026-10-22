import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { organizeReadableText } from '../contentOrganization';

describe('content organization fallback', () => {
  it('keeps source wording while separating dense lines and list items', () => {
    const result = organizeReadableText('Overview\nScrolith connects professionals. It supports creators.\n- Publish updates\n- Find opportunities');
    assert.ok(result.includes('Overview'));
    assert.ok(result.includes('Scrolith connects professionals. It supports creators.'));
    assert.ok(result.includes('- Publish updates'));
    assert.ok(result.split('\n\n').length > 2);
  });
});
