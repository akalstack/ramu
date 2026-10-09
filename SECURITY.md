# Security

Ramu is an alpha desktop application. Security fixes target the latest version.

To report a vulnerability, use **Security → Report a vulnerability** in the GitHub repository when private vulnerability reporting is enabled. If it is unavailable, open an issue asking for a private reporting channel without including exploit details, secrets or private code. Maintainers should enable private vulnerability reporting before making the repository public.

Include the affected version, OS, reproduction steps and impact through the private channel. Remove credentials and personal data from evidence.

Agent tools can read and change files and run commands with your user permissions. Provider authentication, model access and provider-specific permissions remain controlled by their runtimes. Cloud providers receive the context you send, including open files and unsaved edits. Use projects and providers you trust, review changes, and avoid putting secrets in prompts or logs. Closing the window does not stop background agent sessions or schedules; stop them in Ramu when needed.
