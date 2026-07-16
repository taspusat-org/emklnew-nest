import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { ParameterService } from './parameter.service';

describe('ParameterService', () => {
  let service: ParameterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ParameterService],
    }).useMocker(autoMocker).compile();

    service = module.get<ParameterService>(ParameterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
