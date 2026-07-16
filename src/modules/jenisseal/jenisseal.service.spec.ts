import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { JenissealService } from './jenisseal.service';

describe('JenissealService', () => {
  let service: JenissealService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JenissealService],
    }).useMocker(autoMocker).compile();

    service = module.get<JenissealService>(JenissealService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
