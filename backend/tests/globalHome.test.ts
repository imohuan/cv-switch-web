import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveGlobalHomeDir } from '../src/config.ts';

test('global app home ignores runtime root when HOME is polluted by root-dir', () => {
  const actual = resolveGlobalHomeDir(
    {
      HOME: '/mnt/resource/cv-switch-web',
      CV_SWITCH_ROOT_DIR: '/mnt/resource/cv-switch-web',
    },
    '/home/cloud-user',
  );

  assert.equal(actual, path.resolve('/home/cloud-user'));
});

test('global app home defaults to account home instead of process HOME', () => {
  const actual = resolveGlobalHomeDir(
    {
      HOME: '/mnt/resource/other-home',
    },
    '/home/cloud-user',
  );

  assert.equal(actual, path.resolve('/home/cloud-user'));
});

test('global app home supports explicit override independent from root-dir', () => {
  const actual = resolveGlobalHomeDir(
    {
      HOME: '/mnt/resource/cv-switch-web',
      CV_SWITCH_ROOT_DIR: '/mnt/resource/cv-switch-web',
      CV_SWITCH_GLOBAL_HOME_DIR: '~/claude-global',
    },
    '/home/cloud-user',
  );

  assert.equal(actual, path.resolve('/home/cloud-user/claude-global'));
});