import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { BiayaService } from './biaya.service';

describe('BiayaService', () => {
  let service: BiayaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BiayaService],
    }).useMocker(autoMocker).compile();

    service = module.get<BiayaService>(BiayaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
