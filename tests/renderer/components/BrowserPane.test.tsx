import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserPane } from '../../../src/renderer/components/BrowserPane.js';
import { mockApi, ok, renderWithQuery, type CallSpy } from '../test-utils.js';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: () => void) {}
}

let call: CallSpy;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  call = mockApi();
  call.mockImplementation(async () => ok(null));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<BrowserPane>', () => {
  it('renders an address bar and the view-region placeholder', () => {
    renderWithQuery(<BrowserPane tabId="tab-1" />);
    expect(screen.getByTestId('browser-address-bar')).toBeInTheDocument();
    expect(screen.getByTestId('browser-view-region')).toBeInTheDocument();
  });

  it('seeds the address bar from browser.status on mount', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'browser.status') return ok({ url: 'https://example.com/docs' });
      return ok(null);
    });

    renderWithQuery(<BrowserPane tabId="tab-1" />);

    await waitFor(() =>
      expect(screen.getByTestId('browser-address-bar')).toHaveValue('https://example.com/docs'),
    );
  });

  it('reports its bounds to browser.setBounds on mount', async () => {
    renderWithQuery(<BrowserPane tabId="tab-1" />);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('browser.setBounds', {
        tabId: 'tab-1',
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }),
    );
  });

  it('pressing Enter navigates to the typed address, adding https:// when no scheme is given', async () => {
    const user = userEvent.setup();
    renderWithQuery(<BrowserPane tabId="tab-1" />);

    const addressBar = screen.getByTestId('browser-address-bar');
    await user.type(addressBar, 'example.com{Enter}');

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('browser.navigate', { tabId: 'tab-1', url: 'https://example.com' }),
    );
  });

  it('leaves an address that already has a scheme untouched', async () => {
    const user = userEvent.setup();
    renderWithQuery(<BrowserPane tabId="tab-1" />);

    const addressBar = screen.getByTestId('browser-address-bar');
    await user.type(addressBar, 'http://localhost:3000{Enter}');

    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('browser.navigate', { tabId: 'tab-1', url: 'http://localhost:3000' }),
    );
  });

  it('does not navigate on an empty address', async () => {
    const user = userEvent.setup();
    renderWithQuery(<BrowserPane tabId="tab-1" />);

    await user.type(screen.getByTestId('browser-address-bar'), '{Enter}');

    expect(call).not.toHaveBeenCalledWith('browser.navigate', expect.anything());
  });
});
