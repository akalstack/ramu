/** A random UUID for correlating requests and groups; never a credential. Native runtimes do not all expose crypto.randomUUID. */
export const correlationId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (part) => {
    const n = Math.floor(Math.random() * 16)
    return (part === 'x' ? n : (n & 3) | 8).toString(16)
  })
