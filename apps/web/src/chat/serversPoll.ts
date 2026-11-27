/**
 * Reading a thread's servers lists the machine's processes and ports, and on a laptop that machine is usually this
 * one: every few seconds only while the window is in front, once a minute behind other windows.
 */
export const serversPollMs = (focused: boolean) => (focused ? 5000 : 60_000)
