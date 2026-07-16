import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { AcosService } from './acos.service';

describe('AcosService', () => {
  let service: AcosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AcosService],
    }).useMocker(autoMocker).compile();

    service = module.get<AcosService>(AcosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
