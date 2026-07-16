import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ComodityService } from './comodity.service';

describe('ComodityService', () => {
  let service: ComodityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComodityService],
    }).useMocker(autoMocker).compile();

    service = module.get<ComodityService>(ComodityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
