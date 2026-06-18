
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
                        <CardTitle>About NibTera Sales</CardTitle>
                        <CardDescription>Version {appVersion}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center text-muted-foreground space-y-4">
                        <p>
                            The Plan Management System is a self-contained, secure web application designed to manage organizational plans efficiently.
                        </p>
                        <p>
                            It provides a centralized platform for creating, tracking, and managing plans, ensuring data integrity, security, and clear oversight.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </AnimatedContent>
    );
}
