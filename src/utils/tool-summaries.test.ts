import { describe, it, expect } from 'vitest';
import { describeToolAction } from './tool-summaries.js';

describe('describeToolAction', () => {
  it('parses list_path inputs and renders paths', () => {
    const detail = describeToolAction(
      'list_path',
      { input: JSON.stringify({ targetPath: '/Users/test/project/tmp', path: '/Users/test/project/tmp' }) },
      '',
      'success'
    );
    expect(detail).toContain('/Users/test/project/tmp');
  });

  it('parses flattened glob inputs with path metadata', () => {
    const detail = describeToolAction(
      'glob_path',
      {
        input: {
          input: JSON.stringify({
            pattern: '**/sprint5*',
            targetPath: '/Users/test/project',
            maxDepth: 5
          })
        }
      },
      'No files matched pattern "**/sprint5*" under /Users/test/project.',
      'success'
    );
    expect(detail).toContain('**/sprint5*');
    expect(detail).toContain('/Users/test/project');
  });
});
