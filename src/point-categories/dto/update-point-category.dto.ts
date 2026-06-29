import { PartialType } from '@nestjs/swagger';
import { CreatePointCategoryDto } from './create-point-category.dto';

export class UpdatePointCategoryDto extends PartialType(CreatePointCategoryDto) { }
