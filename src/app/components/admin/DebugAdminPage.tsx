import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { DebugLogPanel } from './DebugLogPanel';
import { ApiHealthCheck } from './ApiHealthCheck';
import { AdminDataBrowser } from './AdminDataBrowser';

export function DebugAdminPage() {
  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="debug-log" className="w-full">
        <TabsList className="h-9 bg-muted/20 border border-border/30 mb-4">
          <TabsTrigger value="debug-log" className="font-mono text-[12px] h-8 px-4 data-[state=active]:bg-card">
            Debug 日志
          </TabsTrigger>
          <TabsTrigger value="api-health" className="font-mono text-[12px] h-8 px-4 data-[state=active]:bg-card">
            API 健康检查
          </TabsTrigger>
          <TabsTrigger value="data-browser" className="font-mono text-[12px] h-8 px-4 data-[state=active]:bg-card">
            数据管理
          </TabsTrigger>
          <TabsTrigger value="reserved" className="font-mono text-[12px] h-8 px-4 data-[state=active]:bg-card">
            预留
          </TabsTrigger>
        </TabsList>

        <TabsContent value="debug-log">
          <DebugLogPanel />
        </TabsContent>

        <TabsContent value="api-health">
          <ApiHealthCheck />
        </TabsContent>

        <TabsContent value="data-browser">
          <AdminDataBrowser />
        </TabsContent>

        <TabsContent value="reserved">
          <div className="flex items-center justify-center h-48 rounded-lg border border-border/50 bg-card/30">
            <span className="font-mono text-[13px] text-muted-foreground">功能开发中</span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
