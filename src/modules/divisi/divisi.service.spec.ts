import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { DivisiService } from './divisi.service';

describe('DivisiService', () => {
  let service: DivisiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DivisiService],
    }).useMocker(autoMocker).compile();

    service = module.get<DivisiService>(DivisiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
