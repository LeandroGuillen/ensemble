import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';

/** Keep the canvas and its loaded artwork mounted while its location drawer changes. */
@Injectable()
export class MapRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    return super.shouldReuseRoute(future, current) || (
      future.routeConfig?.data?.['mapCanvas'] === true &&
      current.routeConfig?.data?.['mapCanvas'] === true &&
      future.component === current.component
    );
  }
}
