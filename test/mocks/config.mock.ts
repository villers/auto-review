import { ConfigService } from '@nestjs/config';

export class MockConfigService {
  private configValues: Record<string, any> = {};

  constructor(initialConfig: Record<string, any> = {}) {
    this.configValues = initialConfig;
  }

  get<T = any>(key: string, defaultValue?: T): T {
    return key in this.configValues 
      ? this.configValues[key] 
      : (defaultValue !== undefined ? defaultValue : undefined as T);
  }

  set(key: string, value: any): void {
    this.configValues[key] = value;
  }
}