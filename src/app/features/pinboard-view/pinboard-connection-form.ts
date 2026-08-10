import { DEFAULT_CONNECTION_COLOR } from '../../core/constants/project.constants';

export interface ConnectionFormData {
  source: string;
  target: string;
  label: string;
  color: string;
  labelColor: string;
  arrowFrom: boolean;
  arrowTo: boolean;
}

export function createEmptyConnectionForm(): ConnectionFormData {
  return {
    source: '',
    target: '',
    label: '',
    color: DEFAULT_CONNECTION_COLOR,
    labelColor: '#ffffff',
    arrowFrom: false,
    arrowTo: false,
  };
}
