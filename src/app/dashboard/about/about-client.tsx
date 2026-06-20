
'use client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Logo from "@/components/logo";
import { AnimatedContent } from "@/components/animated-content";

export default function AboutClientPage({ appVersion }: { appVersion: string }) {
    return (
        <AnimatedContent>
            <div className="max-w-2xl mx-auto">
                <Card>
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4">
                            <Logo layout="vertical" />
                        </div>
                        <CardTitle>About NibTera Edir</CardTitle>
                        <CardDescription>Version {appVersion}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center text-muted-foreground space-y-4">
                        <p>
                            NibTera Edir is a secure, multi-tenant platform for managing Ethiopian Edir community associations — members, contributions, emergencies, events, assets, and governance.
                        </p>
                        <p>
                            It provides a centralized, permission-based platform for registering members, collecting contributions, processing emergency benefits, and enforcing each Edir&apos;s rules with clear oversight and full audit trails.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </AnimatedContent>
    );
}
