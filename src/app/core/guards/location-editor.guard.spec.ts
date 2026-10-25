import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { locationEditorGuard } from './location-editor.guard';

describe('locationEditorGuard', () => {
  let mockComponent: { canLeave: jasmine.Spy };
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mockComponent = {
      canLeave: jasmine.createSpy('canLeave')
    };
    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = {} as RouterStateSnapshot;
  });

  it('should allow navigation when canLeave returns true', () => {
    mockComponent.canLeave.and.returnValue(true);
    const result = TestBed.runInInjectionContext(() =>
      locationEditorGuard(mockComponent, mockRoute, mockState, mockState)
    );
    expect(result).toBe(true);
    expect(mockComponent.canLeave).toHaveBeenCalled();
  });

  it('should block navigation when canLeave returns false', () => {
    mockComponent.canLeave.and.returnValue(false);
    const result = TestBed.runInInjectionContext(() =>
      locationEditorGuard(mockComponent, mockRoute, mockState, mockState)
    );
    expect(result).toBe(false);
    expect(mockComponent.canLeave).toHaveBeenCalled();
  });
});
