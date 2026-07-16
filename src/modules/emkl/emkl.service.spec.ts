import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { EmklService } from './emkl.service';

describe('EmklService', () => {
  let service: EmklService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmklService],
    }).useMocker(autoMocker).compile();

    service = module.get<EmklService>(EmklService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
