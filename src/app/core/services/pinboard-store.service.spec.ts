import { PinboardStoreService } from './pinboard-store.service';
import { Project } from '../interfaces/project.interface';
import { ElectronService } from './electron.service';

describe('PinboardStoreService read-only browsing', () => {
  for (const readOnly of [true, false]) {
    it(`keeps pinboard selection and view state in memory (readOnly=${readOnly})`, async () => {
      const electron = jasmine.createSpyObj<ElectronService>('ElectronService', ['writeFileAtomic']);
      electron.writeFileAtomic.and.resolveTo({ success: true });
      const store = new PinboardStoreService(electron);
      const project = {
        path: '/project', readOnly,
        metadata: { settings: {}, pinboards: [{ id: 'cast-a' }, { id: 'cast-b' }] },
      } as Project;
      await store.setCurrent(project, 'cast-b');
      const view = { zoomIndex: 1, viewPosition: { x: 10, y: 20 } };
      await store.saveViewState(project, view);
      expect(store.getCurrent(project)?.id).toBe('cast-b');
      expect(store.getCurrent(project)?.viewState).toEqual(view);
      expect(electron.writeFileAtomic.calls.count()).toBe(readOnly ? 0 : 2);
    });
  }
});
