/** Safe connection categories may cross the host boundary; upstream response text never does. */
export class SharedMcpConnectionError extends Error {
  constructor(readonly status: 'sign-in-required' | 'insufficient-permission') {
    super(
      status === 'sign-in-required'
        ? 'Sign in to the external service before connecting this server.'
        : 'The external service denied access. Check the selected service account and organization permissions.',
    )
  }
}
