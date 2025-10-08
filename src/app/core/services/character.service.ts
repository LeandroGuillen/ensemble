import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Character, CharacterFormData } from '../interfaces/character.interface';

@Injectable({
  providedIn: 'root'
})
export class CharacterService {
  private charactersSubject = new BehaviorSubject<Character[]>([]);
  public characters$ = this.charactersSubject.asObservable();

  constructor() {}

  getCharacters(): Observable<Character[]> {
    return this.characters$;
  }

  getCharacterById(id: string): Character | undefined {
    return this.charactersSubject.value.find(char => char.id === id);
  }

  async loadCharacters(projectPath: string): Promise<void> {
    // TODO: Implement file system loading
    console.log('Loading characters from:', projectPath);
  }

  async createCharacter(data: CharacterFormData): Promise<Character> {
    // TODO: Implement character creation
    const character: Character = {
      id: this.generateId(),
      ...data,
      created: new Date(),
      modified: new Date(),
      filePath: ''
    };
    
    const currentCharacters = this.charactersSubject.value;
    this.charactersSubject.next([...currentCharacters, character]);
    
    return character;
  }

  async updateCharacter(id: string, data: Partial<CharacterFormData>): Promise<Character | null> {
    // TODO: Implement character update
    const characters = this.charactersSubject.value;
    const index = characters.findIndex(char => char.id === id);
    
    if (index === -1) return null;
    
    const updatedCharacter = {
      ...characters[index],
      ...data,
      modified: new Date()
    };
    
    characters[index] = updatedCharacter;
    this.charactersSubject.next([...characters]);
    
    return updatedCharacter;
  }

  async deleteCharacter(id: string): Promise<boolean> {
    // TODO: Implement character deletion
    const characters = this.charactersSubject.value;
    const filteredCharacters = characters.filter(char => char.id !== id);
    
    if (filteredCharacters.length === characters.length) return false;
    
    this.charactersSubject.next(filteredCharacters);
    return true;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}