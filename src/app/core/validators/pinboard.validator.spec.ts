import { PinboardValidator } from './pinboard.validator';
import { PinboardConnection, PinboardPin, PinboardData } from '../interfaces/pinboard.interface';

describe('PinboardValidator', () => {
  describe('validateConnection', () => {
    const createValidConnection = (): PinboardConnection => ({
      id: 'conn-1',
      source: 'char-1',
      target: 'char-2',
      type: 'friend',
      label: 'Friends',
      color: '#FF0000',
      bidirectional: false
    });

    it('should validate valid connection', () => {
      const connection = createValidConnection();
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when id is missing', () => {
      const connection = createValidConnection();
      connection.id = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when source is missing', () => {
      const connection = createValidConnection();
      connection.source = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'source' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when target is missing', () => {
      const connection = createValidConnection();
      connection.target = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when type is missing', () => {
      const connection = createValidConnection();
      connection.type = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'type' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when label is missing', () => {
      const connection = createValidConnection();
      connection.label = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'label' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when color is missing', () => {
      const connection = createValidConnection();
      connection.color = '';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when bidirectional is not boolean', () => {
      const connection: any = createValidConnection();
      connection.bidirectional = 'true';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'bidirectional' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when source equals target (self-reference)', () => {
      const connection = createValidConnection();
      connection.target = connection.source;
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'target' && e.code === 'SELF_REFERENCE')).toBe(true);
    });

    it('should fail validation when color is not hex format', () => {
      const connection = createValidConnection();
      connection.color = 'red';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid hex color', () => {
      const connection = createValidConnection();
      connection.color = '#FF0000';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(true);
    });

    it('should pass validation with 3-digit hex color', () => {
      const connection = createValidConnection();
      connection.color = '#F00';
      const result = PinboardValidator.validateConnection(connection);
      
      expect(result.isValid).toBe(true);
    });
  });

  describe('validatePin', () => {
    const createValidPin = (): PinboardPin => ({
      id: 'pin-1',
      name: 'Test Pin',
      position: { x: 100, y: 200 }
    });

    it('should validate valid pin', () => {
      const pin = createValidPin();
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when id is missing', () => {
      const pin = createValidPin();
      pin.id = '';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'id' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when name is missing', () => {
      const pin = createValidPin();
      pin.name = '';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'name' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when position is missing', () => {
      const pin: any = createValidPin();
      pin.position = null;
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'position' && e.code === 'REQUIRED_FIELD')).toBe(true);
    });

    it('should fail validation when position.x is not a number', () => {
      const pin: any = createValidPin();
      pin.position.x = '100';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'position.x' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when position.y is not a number', () => {
      const pin: any = createValidPin();
      pin.position.y = '200';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'position.y' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when position.x is NaN', () => {
      const pin: any = createValidPin();
      pin.position.x = NaN;
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'position.x' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when color is not hex format', () => {
      const pin = createValidPin();
      pin.color = 'blue';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'color' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('should pass validation with valid optional color', () => {
      const pin = createValidPin();
      pin.color = '#00FF00';
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(true);
    });

    it('should pass validation without color', () => {
      const pin = createValidPin();
      const result = PinboardValidator.validatePin(pin);
      
      expect(result.isValid).toBe(true);
    });
  });

  describe('validatePinboardData', () => {
    const createValidPinboardData = (): PinboardData => ({
      nodes: [
        { id: 'pin-1', name: 'Pin 1', position: { x: 100, y: 100 } },
        { id: 'pin-2', name: 'Pin 2', position: { x: 200, y: 200 } }
      ],
      edges: [
        {
          id: 'conn-1',
          source: 'pin-1',
          target: 'pin-2',
          type: 'friend',
          label: 'Friends',
          color: '#FF0000',
          bidirectional: false
        }
      ]
    });

    it('should validate valid pinboard data', () => {
      const data = createValidPinboardData();
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should fail validation when nodes is not an array', () => {
      const data: any = createValidPinboardData();
      data.nodes = 'not-an-array';
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'nodes' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when edges is not an array', () => {
      const data: any = createValidPinboardData();
      data.edges = 'not-an-array';
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'edges' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('should fail validation when duplicate node IDs exist', () => {
      const data = createValidPinboardData();
      data.nodes.push({ id: 'pin-1', name: 'Duplicate', position: { x: 300, y: 300 } });
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'nodes' && e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('should fail validation when edge source does not exist in nodes', () => {
      const data = createValidPinboardData();
      data.edges[0].source = 'non-existent-pin';
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'edges[0].source' && e.code === 'INVALID_REFERENCE')).toBe(true);
    });

    it('should fail validation when edge target does not exist in nodes', () => {
      const data = createValidPinboardData();
      data.edges[0].target = 'non-existent-pin';
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'edges[0].target' && e.code === 'INVALID_REFERENCE')).toBe(true);
    });

    it('should validate invalid nodes within pinboard data', () => {
      const data = createValidPinboardData();
      data.nodes.push({ id: '', name: 'Invalid', position: { x: 300, y: 300 } });
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.startsWith('nodes[') && e.field.includes('id'))).toBe(true);
    });

    it('should validate invalid edges within pinboard data', () => {
      const data = createValidPinboardData();
      data.edges.push({
        id: '',
        source: 'pin-1',
        target: 'pin-2',
        type: 'friend',
        label: 'Friends',
        color: '#FF0000',
        bidirectional: false
      });
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.startsWith('edges[') && e.field.includes('id'))).toBe(true);
    });

    it('should pass validation with empty nodes and edges', () => {
      const data: PinboardData = { nodes: [], edges: [] };
      const result = PinboardValidator.validatePinboardData(data);
      
      expect(result.isValid).toBe(true);
    });
  });
});

