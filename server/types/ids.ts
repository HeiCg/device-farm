import { z } from 'zod';

export const JobIdSchema       = z.string().uuid().brand<'JobId'>();
export const DeviceIdSchema    = z.string().uuid().brand<'DeviceId'>();
export const PipelineIdSchema  = z.string().uuid().brand<'PipelineId'>();
export const ArtifactIdSchema  = z.string().uuid().brand<'ArtifactId'>();
export const RecordingIdSchema = z.string().uuid().brand<'RecordingId'>();

export type JobId       = z.infer<typeof JobIdSchema>;
export type DeviceId    = z.infer<typeof DeviceIdSchema>;
export type PipelineId  = z.infer<typeof PipelineIdSchema>;
export type ArtifactId  = z.infer<typeof ArtifactIdSchema>;
export type RecordingId = z.infer<typeof RecordingIdSchema>;

export const toJobId       = (v: string): JobId       => JobIdSchema.parse(v);
export const toDeviceId    = (v: string): DeviceId    => DeviceIdSchema.parse(v);
export const toPipelineId  = (v: string): PipelineId  => PipelineIdSchema.parse(v);
export const toArtifactId  = (v: string): ArtifactId  => ArtifactIdSchema.parse(v);
export const toRecordingId = (v: string): RecordingId => RecordingIdSchema.parse(v);
