import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { KapalService } from './kapal.service';

describe('KapalService', () => {
  let service: KapalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KapalService],
    })
      .useMocker(autoMocker)
      .compile();

    service = module.get<KapalService>(KapalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
