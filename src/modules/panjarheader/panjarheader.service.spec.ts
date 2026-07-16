import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { PanjarheaderService } from './panjarheader.service';

describe('PanjarheaderService', () => {
  let service: PanjarheaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PanjarheaderService],
    }).useMocker(autoMocker).compile();

    service = module.get<PanjarheaderService>(PanjarheaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
