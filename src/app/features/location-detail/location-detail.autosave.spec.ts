import { FormBuilder, Validators } from '@angular/forms';
import { LocationDetailComponent } from './location-detail.component';

describe('Location sidebar autosave', () => {
  let component: LocationDetailComponent;
  let update: jasmine.Spy;
  let create: jasmine.Spy;
  let navigate: jasmine.Spy;
  let currentProject: { readOnly: boolean };

  beforeEach(() => {
    component = Object.create(LocationDetailComponent.prototype);
    Object.assign(component, {
      embedded: true, isNewLocation: false, isSaving: false, isLoading: false,
      loadError: '', saveError: '', aliasDraft: '', pendingAutoSave: null,
      locationId: 'a', location: { id: 'a', name: 'Harbor', content: 'Original', aliases: [] },
    });
    component.locationForm = new FormBuilder().group({
      name: ['Harbor', Validators.required], aliasesText: [''], content: ['Original'],
      mapIcon: [''], destinationMapId: [''], type: ['settlement'], books: [[]], thumbnail: [''],
    });
    update = jasmine.createSpy().and.callFake(async (id, data) => ({ ...data, id }));
    create = jasmine.createSpy().and.callFake(async data => ({ ...data, id: 'created' }));
    navigate = jasmine.createSpy().and.resolveTo(true);
    currentProject = { readOnly: false };
    Object.assign(component as any, {
      locationService: { createLocation: create, updateLocation: update },
      linkRename: { run: (_old: unknown, _name: string, _type: string, save: () => Promise<unknown>) => save() },
      projectService: { getCurrentProject: () => currentProject },
      router: { navigate },
      notificationService: { showSuccess: jasmine.createSpy() },
      logger: { error: () => {} }, cdr: { markForCheck: () => {} },
      imagePickerService: { handleNavigationAway: () => true },
    });
  });

  function edit(content: string): void {
    component.locationForm.patchValue({ content });
    component.locationForm.markAsDirty();
  }

  it('saves the chosen destination before opening it, and blocks opening on failed saves', async () => {
    component.destinationMaps = [{ id: 'city', name: 'City map' }];
    component.activeMapId = 'world';
    const emit = jasmine.createSpy('destinationOpen');
    (component as any).destinationOpen = { emit };
    component.locationForm.patchValue({ destinationMapId: 'city' });
    component.locationForm.markAsDirty();
    await component.openDestination();
    expect(update.calls.mostRecent().args[1].destinationMapId).toBe('city');
    expect(emit).toHaveBeenCalledOnceWith('city');
    emit.calls.reset();
    edit('Unsaved notes');
    update.and.rejectWith(new Error('Disk full'));
    await component.openDestination();
    expect(emit).not.toHaveBeenCalled();
    component.activeMapId = 'city';
    await component.openDestination();
    expect(emit).not.toHaveBeenCalled();
  });

  it('saves edits without a button, toast, or navigation', async () => {
    edit('Updated');
    expect(await component.flushAutoSave()).toBeTrue();
    expect(update.calls.mostRecent().args[1].content).toBe('Updated');
    expect(component.locationForm.pristine).toBeTrue();
    expect((component as any).notificationService.showSuccess).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('serializes writes and finishes newer edits before switching locations', async () => {
    let finishFirst!: (value: unknown) => void;
    update.and.callFake((id, data) => update.calls.count() === 1
      ? new Promise(resolve => { finishFirst = resolve; })
      : Promise.resolve({ ...data, id }));
    edit('First draft');
    const saving = component.flushAutoSave(false);
    expect(component.isSaving).toBeTrue();
    edit('Second draft, typed during the write');
    const leaving = component.canLeave();
    finishFirst({ id: 'a', name: 'Harbor', aliases: [], content: 'First draft' });
    expect(await saving).toBeTrue();
    expect(await leaving).toBeTrue();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.calls.mostRecent().args[1].content).toBe('Second draft, typed during the write');
    expect(component.locationForm.get('content')!.value).toBe('Second draft, typed during the write');
    expect(component.locationForm.pristine).toBeTrue();
  });

  it('keeps failed edits and blocks navigation until a retry succeeds', async () => {
    update.and.rejectWith(new Error('Disk full'));
    edit('Keep this text');
    expect(await component.flushAutoSave()).toBeFalse();
    expect(component.saveError).toBe('Disk full');
    expect(component.locationForm.dirty).toBeTrue();
    expect(await component.canLeave()).toBeFalse();
    expect(component.locationForm.get('content')!.value).toBe('Keep this text');
    update.and.callFake(async (id, data) => ({ ...data, id }));
    expect(await component.flushAutoSave()).toBeTrue();
    expect(component.saveError).toBe('');
  });

  it('creates once, then updates when typing continues during creation', async () => {
    let finishCreate!: (value: unknown) => void;
    component.isNewLocation = true;
    component.locationId = null;
    component.location = null;
    create.and.returnValue(new Promise(resolve => { finishCreate = resolve; }));
    edit('First');
    const saving = component.flushAutoSave(false);
    edit('Latest');
    const joined = component.flushAutoSave(false);
    finishCreate({ id: 'created', name: 'Harbor', aliases: [], content: 'First' });
    await Promise.all([saving, joined]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.calls.mostRecent().args[0]).toBe('created');
    expect(update.calls.mostRecent().args[1].content).toBe('Latest');
    expect(component.isNewLocation).toBeFalse();
    expect(component.locationForm.pristine).toBeTrue();
  });

  it('uses compact aliases, commits a draft before leaving, and rejects duplicates', async () => {
    component.aliasDraft = 'Grey Harbor';
    component.onAliasKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    component.aliasDraft = 'grey harbor';
    component.addAlias();
    expect(component.aliases).toEqual(['Grey Harbor']);
    component.aliasDraft = 'Port';
    expect(await component.canLeave()).toBeTrue();
    expect(update.calls.mostRecent().args[1].aliases).toEqual(['Grey Harbor', 'Port']);
    component.removeAlias(0);
    expect(component.aliases).toEqual(['Port']);
  });

  it('never autosaves a read-only project', async () => {
    currentProject.readOnly = true;
    edit('Local unsaved draft');
    expect(await component.flushAutoSave()).toBeFalse();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(component.locationForm.dirty).toBeTrue();
  });
});
