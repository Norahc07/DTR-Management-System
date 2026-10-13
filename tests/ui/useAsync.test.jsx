// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { clearAsyncCache, useAsync } from '@/hooks/useAsync';

describe('useAsync page cache', () => {
  it('shows the last data at once when a page is opened again, then refreshes it', async () => {
    clearAsyncCache();
    const loader = vi.fn().mockResolvedValueOnce(['first']).mockResolvedValueOnce(['second']);
    const first = renderHook(() => useAsync(loader, [2026], { cacheKey: 'lates' }));
    expect(first.result.current.data).toBeUndefined();
    await waitFor(() => expect(first.result.current.data).toEqual(['first']));
    first.unmount();

    const again = renderHook(() => useAsync(loader, [2026], { cacheKey: 'lates' }));
    expect(again.result.current.data).toEqual(['first']);
    await waitFor(() => expect(again.result.current.data).toEqual(['second']));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps entries separate per key and deps, and forgets everything on sign-out', async () => {
    clearAsyncCache();
    const a = renderHook(() => useAsync(() => Promise.resolve('2026'), [2026], { cacheKey: 'lates' }));
    await waitFor(() => expect(a.result.current.data).toBe('2026'));
    a.unmount();
    expect(renderHook(() => useAsync(() => new Promise(() => {}), [2025], { cacheKey: 'lates' })).result.current.data).toBeUndefined();
    expect(renderHook(() => useAsync(() => new Promise(() => {}), [2026], { cacheKey: 'other' })).result.current.data).toBeUndefined();
    clearAsyncCache();
    expect(renderHook(() => useAsync(() => new Promise(() => {}), [2026], { cacheKey: 'lates' })).result.current.data).toBeUndefined();
  });

  it('does not cache without a key', async () => {
    clearAsyncCache();
    const a = renderHook(() => useAsync(() => Promise.resolve('x'), [1]));
    await waitFor(() => expect(a.result.current.data).toBe('x'));
    a.unmount();
    expect(renderHook(() => useAsync(() => new Promise(() => {}), [1])).result.current.data).toBeUndefined();
  });
});
