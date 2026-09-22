import manifest from '@/../manifest.json';
import { version } from '@/util/tavern';

export function getTavernHelperVersion(): string {
  return manifest.version;
}

export function getTavernVersion(): string {
  return version;
}
