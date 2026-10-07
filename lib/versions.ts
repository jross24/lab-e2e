// A release version of the lab looks like 0.1.0.
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const APPLICATIONS = ['web', 'catalogue', 'account', 'core'] as const;

// The version of each application, as the run observed it.
export type Versions = Readonly<Record<(typeof APPLICATIONS)[number], string>>;
