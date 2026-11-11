import { Injectable } from '@angular/core';
import { isSameOrInsidePath } from '../utils/path.utils';

export const READ_ONLY_PROJECT_MESSAGE = 'This project is read-only. Open a writable copy to make changes.';

/** Session-only protection, including writable files inside a read-only project. */
@Injectable({ providedIn: 'root' })
export class ProjectWriteProtectionService {
  readOnlyPath: string | null = null;

  blocks(...paths: string[]): boolean {
    return !!this.readOnlyPath && paths.some(path => isSameOrInsidePath(this.readOnlyPath!, path));
  }
}
